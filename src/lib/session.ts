/**
 * Login (Firebase Authentication) e chamadas ao servidor com o token da pessoa.
 * A configuração pública do Firebase vem do servidor (/api/public-config), então não é
 * preciso recompilar o app para trocar de projeto.
 */
import { initializeApp } from 'firebase/app';
import type { Auth, User } from 'firebase/auth';
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';

export interface PublicConfig {
  firebase: Record<string, string> | null;
  mapsApiKey: string;
  paymentsEnabled: boolean;
}

let auth: Auth | null = null;

export async function loadPublicConfig(): Promise<PublicConfig> {
  const res = await fetch('/api/public-config');
  if (!res.ok) throw new Error('Não foi possível carregar a configuração do app.');
  const cfg = (await res.json()) as PublicConfig;
  if (cfg.firebase && !auth) auth = getAuth(initializeApp(cfg.firebase));
  return cfg;
}

function requireAuth(): Auth {
  if (!auth) throw new Error('Login indisponível: o Firebase ainda não foi configurado no servidor.');
  return auth;
}

export function watchUser(callback: (user: User | null) => void) {
  return onAuthStateChanged(requireAuth(), callback);
}

const AUTH_ERRORS: Record<string, string> = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'E-mail ou senha incorretos.',
  'auth/email-already-in-use': 'Este e-mail já tem conta. Use "Entrar".',
  'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos.',
  'auth/network-request-failed': 'Sem conexão com a internet.',
  'auth/popup-closed-by-user': 'Janela do Google fechada antes de terminar. Tente de novo.',
  'auth/cancelled-popup-request': 'Janela do Google fechada antes de terminar. Tente de novo.',
  'auth/popup-blocked': 'O navegador bloqueou a janela do Google. Permita pop-ups para este site e tente de novo.',
  'auth/unauthorized-domain':
    'Este endereço ainda não está autorizado no Firebase. No console do Firebase: Authentication > Configurações > Domínios autorizados > adicione froc-x-uber.vercel.app.',
  'auth/operation-not-allowed': 'Este tipo de login não está ativado no Firebase (Authentication > Método de login).',
  'auth/account-exists-with-different-credential': 'Este e-mail já entra de outro jeito. Use e-mail e senha.',
  'auth/user-disabled': 'Esta conta foi desativada.',
};

function friendly(error: unknown): Error {
  const code = (error as { code?: string })?.code || '';
  return new Error(AUTH_ERRORS[code] || 'Não foi possível concluir. Tente novamente.');
}

export async function signIn(email: string, password: string) {
  try {
    await signInWithEmailAndPassword(requireAuth(), email.trim(), password);
  } catch (e) {
    throw friendly(e);
  }
}

/** Entrar com a conta Google (o e-mail já vem confirmado pelo Google). */
export async function signInWithGoogle() {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(requireAuth(), provider);
  } catch (e) {
    throw friendly(e);
  }
}

export async function signUp(name: string, email: string, password: string) {
  try {
    const cred = await createUserWithEmailAndPassword(requireAuth(), email.trim(), password);
    await updateProfile(cred.user, { displayName: name.trim() });
    await sendEmailVerification(cred.user).catch(() => undefined);
    await cred.user.getIdToken(true);
  } catch (e) {
    throw friendly(e);
  }
}

/** Reenvia o link de confirmação de e-mail (contas antigas não recebem no cadastro). */
export async function resendVerification() {
  const user = requireAuth().currentUser;
  if (!user) throw new Error('Faça login para continuar.');
  await user.reload().catch(() => undefined);
  if (user.emailVerified) return 'already';
  try {
    await sendEmailVerification(user);
    return 'sent';
  } catch (e) {
    throw friendly(e);
  }
}

export async function resetPassword(email: string) {
  try {
    await sendPasswordResetEmail(requireAuth(), email.trim());
  } catch (e) {
    throw friendly(e);
  }
}

export async function logout() {
  await signOut(requireAuth());
}

/** Chama o servidor com o token do Firebase. Erros viram mensagens em português. */
/**
 * Identificador aleatório deste aparelho/navegador (não é dado pessoal). Ajuda a equipe a
 * perceber muitas contas criadas no mesmo aparelho (regra: uma pessoa, uma conta).
 */
export function deviceId(): string {
  try {
    let id = localStorage.getItem('froc-aparelho');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('froc-aparelho', id);
    }
    return id;
  } catch {
    return '';
  }
}

/** Erro do servidor com o código (ex.: cpf_required) para a tela reagir. */
export class ApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const user = requireAuth().currentUser;
  if (!user) throw new Error('Faça login para continuar.');
  // Quem ainda não confirmou o e-mail: confere de novo no Firebase. Assim que o link de
  // confirmação for clicado, o token é renovado e o servidor passa a ver "verificado"
  // (necessário para liberar a aba Admin) sem precisar sair e entrar.
  let renew = false;
  if (!user.emailVerified) {
    await user.reload().catch(() => undefined);
    renew = user.emailVerified;
  }
  const send = async (fresh: boolean) =>
    fetch(path, {
      method: init.method || (init.body ? 'POST' : 'GET'),
      headers: {
        Authorization: `Bearer ${await user.getIdToken(fresh)}`,
        ...(deviceId() ? { 'X-Froc-Device': deviceId() } : {}),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  let res = await send(renew);
  // Token recusado: pega um novo no Firebase e tenta uma vez mais antes de mostrar erro.
  if (res.status === 401) res = await send(true);
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    if (res.status === 413) throw new Error('Arquivo grande demais. Envie uma foto menor ou um PDF de até 3 MB.');
    if (data.code === 'cpf_required') window.dispatchEvent(new Event('froc:cpf-required'));
    throw new ApiError(data.error || (res.status >= 500 ? 'O servidor não respondeu. Tente de novo em instantes.' : 'Erro de conexão com o servidor.'), data.code || '');
  }
  return data as T;
}

/**
 * Fotos de celular costumam ter 4 a 10 MB. Antes de enviar, a foto é reduzida
 * (lado maior 1800 px, JPEG) para ficar leve e passar no limite do servidor.
 * PDF vai como está (limite de 3 MB).
 */
export async function prepareUpload(file: File): Promise<{ contentType: string; dataBase64: string; size: number }> {
  if (file.type === 'application/pdf') {
    if (file.size > 3 * 1024 * 1024) throw new Error('O PDF deve ter até 3 MB. Se puder, envie uma foto do documento.');
    return { contentType: file.type, dataBase64: await fileToBase64(file), size: file.size };
  }
  if (!file.type.startsWith('image/')) throw new Error('Envie uma foto (JPG, PNG) ou PDF.');
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    if (file.size > 3 * 1024 * 1024) throw new Error('Não consegui ler esta foto. Tire outra foto ou envie em JPG.');
    return { contentType: file.type, dataBase64: await fileToBase64(file), size: file.size };
  }
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error('Não consegui preparar a foto. Tente outra.');
  const reduced = new File([blob], 'documento.jpg', { type: 'image/jpeg' });
  return { contentType: 'image/jpeg', dataBase64: await fileToBase64(reduced), size: reduced.size };
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}
