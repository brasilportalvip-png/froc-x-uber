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
  const token = await user.getIdToken(renew);
  const res = await fetch(path, {
    method: init.method || (init.body ? 'POST' : 'GET'),
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || 'Erro de conexão com o servidor.');
  return data as T;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}
