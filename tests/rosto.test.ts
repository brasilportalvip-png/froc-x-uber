/**
 * Foto de perfil obrigatória e reconhecimento facial do motorista (pedido do dono, 19/11/2026):
 *  - passageiro e motorista precisam de foto (identificação) e podem trocar;
 *  - motorista faz reconhecimento facial com a câmera no cadastro (referência salva, comparada com a CNH);
 *  - motorista trabalhando confere o rosto a cada 2h; se não bater, fica offline na hora e a equipe confere;
 *  - cabelo e barba crescem: quem decide é a regra (a IA só compara a estrutura do rosto).
 * A IA é simulada aqui: cada "foto" diz de quem é o rosto.
 * Rodar: npm test
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../server/store.ts';
import { AppError, FrocService } from '../server/services.ts';
import type { AuthUser, FileStorage } from '../server/services.ts';
import { createGridGeo } from '../server/geo.ts';
import { FACE_CHECK_EVERY_MS, decideFaceCheck, photoProblem } from '../server/faceCheck.ts';
import type { FaceChecker, Img } from '../server/faceCheck.ts';

const H = 3600_000;
const ana: AuthUser = { uid: 'p1', email: 'ana@x.com', emailVerified: true, name: 'Ana' };
const caio: AuthUser = { uid: 'd1', email: 'caio@x.com', emailVerified: true, name: 'Caio' };
const admin: AuthUser = { uid: 'a1', email: 'dono@froc.com', emailVerified: true, name: 'Dono' };
const LEGAL = { cnhExpiry: '2035-01-01', city: 'São Paulo', state: 'SP', vehicleYear: 2022, vehicleType: 'carro', declarations: { ear: true, inss: true, seguroApp: true, veracidade: true } };
const SP = { originId: 'sp-paulista', destinationId: 'sp-pinheiros' };

/** "Foto" de teste: o conteúdo diz de quem é o rosto (ou "sem-rosto", "desenho", "escura"). */
const foto = (quem: string) => ({ contentType: 'image/jpeg', dataBase64: Buffer.from(quem).toString('base64') });
const quemE = (i: Img) => Buffer.from(i.bytes).toString();

let iaFora = false;
const ia: FaceChecker = {
  configured: true,
  async reviewPhoto(i) {
    if (iaFora) throw new Error('fora do ar');
    const q = quemE(i);
    return { umRosto: !q.startsWith('sem-rosto') && q !== 'duas-pessoas', fotoReal: q !== 'desenho', nitida: q !== 'escura', motivo: '' };
  },
  async compare(ref, cand) {
    if (iaFora) throw new Error('fora do ar');
    const base = (s: string) => s.replace(/-(barba|cabelo|oculos)$/, ''); // cabelo e barba crescem
    const c = quemE(cand);
    if (c.startsWith('sem-rosto') || c === 'escura') return { verdict: c === 'escura' ? 'inconclusivo' : 'sem_rosto', confianca: 0.2, observacoes: '' };
    const same = ref.some((r) => base(quemE(r)) === base(c));
    return { verdict: same ? 'mesma_pessoa' : 'outra_pessoa', confianca: 0.9, observacoes: '' };
  },
};

let store: MemoryStore;
let svc: FrocService;
let clock: number;
let files: Map<string, { bytes: Uint8Array; contentType: string }>;
const storage: FileStorage = {
  async save(path, contentType, bytes) {
    files.set(path, { bytes, contentType });
  },
  async signedUrl(p) {
    return 'https://x/' + p;
  },
  async read(p) {
    return files.get(p) ?? null;
  },
};

async function erro(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof AppError && e.code === code, `esperava ${code}`);
}
const perfil = async (u: AuthUser) => (await svc.bootstrap(u)).profile;
const enviarDocs = async (u: AuthUser, cnhDe = 'caio') => {
  await svc.uploadDocument(u, 'driver', 'cnh', 'image/jpeg', Buffer.from(cnhDe).toString('base64'));
  for (const d of ['crlv', 'antecedentes']) await svc.uploadDocument(u, 'driver', d, 'image/png', 'eA==');
};
const aplicar = (u: AuthUser) => svc.applyAsProvider(u, 'driver', { ...LEGAL, phone: '11988887777', vehicle: 'Onix Prata', plate: 'ABC1D23' });

/** Motorista aprovado com reconhecimento facial feito. */
async function motoristaPronto() {
  await enviarDocs(caio);
  await svc.enrollFace(caio, 'image/jpeg', foto('caio').dataBase64, true);
  await aplicar(caio);
  await svc.reviewApplication(admin, caio.uid, 'driver', 'approved', '');
}

beforeEach(async () => {
  iaFora = false;
  clock = Date.parse('2026-11-19T12:00:00Z');
  files = new Map();
  store = new MemoryStore();
  svc = new FrocService(store, {
    now: () => new Date(clock),
    adminEmails: ['dono@froc.com'],
    geo: createGridGeo(),
    files: storage,
    faces: { required: true, checker: ia },
  });
  for (const u of [ana, caio, admin]) await svc.ensureUser(u);
});

describe('regras puras', () => {
  test('foto de perfil: um rosto, real e nítida', () => {
    assert.equal(photoProblem({ umRosto: true, fotoReal: true, nitida: true, motivo: '' }), '');
    assert.match(photoProblem({ umRosto: false, fotoReal: true, nitida: true, motivo: '' }), /seu rosto/);
    assert.match(photoProblem({ umRosto: true, fotoReal: false, nitida: true, motivo: '' }), /de verdade/);
    assert.match(photoProblem({ umRosto: true, fotoReal: true, nitida: false, motivo: '' }), /escura/);
  });
  test('conferência: confere, não confere, repetir e 3ª tentativa vai para a equipe', () => {
    assert.equal(decideFaceCheck({ verdict: 'mesma_pessoa', confianca: 0.8, observacoes: '' }, 0).result, 'aprovado');
    assert.equal(decideFaceCheck({ verdict: 'mesma_pessoa', confianca: 0.5, observacoes: '' }, 0).result, 'repetir', 'confiança baixa: tira de novo');
    assert.equal(decideFaceCheck({ verdict: 'outra_pessoa', confianca: 0.9, observacoes: '' }, 0).result, 'bloqueado');
    assert.equal(decideFaceCheck({ verdict: 'outra_pessoa', confianca: 0.4, observacoes: '' }, 0).result, 'repetir', 'dúvida não pune');
    assert.equal(decideFaceCheck({ verdict: 'sem_rosto', confianca: 0, observacoes: '' }, 0).result, 'repetir');
    assert.equal(decideFaceCheck({ verdict: 'inconclusivo', confianca: 0, observacoes: '' }, 2).result, 'revisao');
  });
});

describe('foto de perfil obrigatória', () => {
  test('sem foto não pede corrida; com foto pede', async () => {
    assert.equal((await perfil(ana)).hasPhoto, false);
    assert.equal((await perfil(ana)).photoRequired, true);
    await erro(svc.createRide(ana, { ...SP, categoryId: 'froc_x' }), 'photo_required');
    await svc.uploadProfilePhoto(ana, 'image/jpeg', foto('ana').dataBase64);
    assert.equal((await perfil(ana)).hasPhoto, true);
    await erro(svc.createRide(ana, { ...SP, categoryId: 'froc_x' }), 'insufficient_balance'); // passou da foto
  });

  test('foto ruim é recusada com o motivo', async () => {
    await erro(svc.uploadProfilePhoto(ana, 'image/jpeg', foto('sem-rosto').dataBase64), 'bad_photo');
    await erro(svc.uploadProfilePhoto(ana, 'image/jpeg', foto('desenho').dataBase64), 'bad_photo');
    await erro(svc.uploadProfilePhoto(ana, 'application/pdf', foto('ana').dataBase64), 'invalid_file');
  });

  test('trocar a foto: o passageiro troca à vontade', async () => {
    await svc.uploadProfilePhoto(ana, 'image/jpeg', foto('ana').dataBase64);
    const antes = (await perfil(ana)).photoAt;
    clock += 60_000;
    await svc.uploadProfilePhoto(ana, 'image/jpeg', foto('ana-cabelo').dataBase64);
    assert.notEqual((await perfil(ana)).photoAt, antes);
  });

  test('IA fora do ar: a foto é aceita (não trava o cadastro)', async () => {
    iaFora = true;
    await svc.uploadProfilePhoto(ana, 'image/jpeg', foto('qualquer').dataBase64);
    assert.equal((await perfil(ana)).hasPhoto, true);
  });
});

describe('reconhecimento facial no cadastro do motorista', () => {
  test('sem reconhecimento facial o cadastro não é enviado', async () => {
    await enviarDocs(caio);
    await erro(aplicar(caio), 'face_enroll_required');
  });

  test('precisa autorizar (dado biométrico); vira a foto de perfil; compara com a CNH', async () => {
    await enviarDocs(caio);
    await erro(svc.enrollFace(caio, 'image/jpeg', foto('caio').dataBase64, false), 'consent_required');
    const r = await svc.enrollFace(caio, 'image/jpeg', foto('caio').dataBase64, true);
    assert.equal(r.cnhMatch, 'confere');
    const p = await perfil(caio);
    assert.equal(p.faceEnrolled, true);
    assert.equal(p.hasPhoto, true);
  });

  test('rosto diferente da CNH fica marcado para a equipe', async () => {
    await enviarDocs(caio, 'outro-homem');
    const r = await svc.enrollFace(caio, 'image/jpeg', foto('caio').dataBase64, true);
    assert.equal(r.cnhMatch, 'nao_confere');
    assert.equal((await store.get<Record<string, unknown>>('users', caio.uid))?.faceCnhMatch, 'nao_confere');
  });

  test('depois de aprovado, ninguém troca o rosto da conta sozinho; foto nova precisa ser a mesma pessoa', async () => {
    await motoristaPronto();
    await erro(svc.enrollFace(caio, 'image/jpeg', foto('irmao').dataBase64, true), 'face_already_enrolled');
    await erro(svc.uploadProfilePhoto(caio, 'image/jpeg', foto('irmao').dataBase64), 'photo_not_you');
    await svc.uploadProfilePhoto(caio, 'image/jpeg', foto('caio-barba').dataBase64);
  });
});

describe('verificação a cada 2h com o motorista trabalhando', () => {
  test('fica online e aceita; passadas 2h, precisa da selfie para continuar', async () => {
    await motoristaPronto();
    await svc.updateProfile(caio, { driverOnline: true });
    assert.equal((await perfil(caio)).faceCheckDue, false);
    clock += 2 * H + 60_000;
    const p = await perfil(caio);
    assert.equal(p.faceCheckDue, true);
    await svc.uploadProfilePhoto(ana, 'image/jpeg', foto('ana').dataBase64);
    await store.update('users', ana.uid, { balanceCents: 10000 });
    const ride = await svc.createRide(ana, { ...SP, categoryId: 'froc_x' });
    await erro(svc.rideAction(caio, ride.id, { action: 'driver_accept' }), 'face_check_required');
    const r = await svc.submitFaceCheck(caio, 'image/jpeg', foto('caio-barba').dataBase64);
    assert.equal(r.result, 'aprovado', 'barba crescida não reprova');
    assert.equal((await perfil(caio)).faceCheckDue, false);
    await svc.rideAction(caio, ride.id, { action: 'driver_accept' });
  });

  test('ficar online com a verificação vencida pede a selfie antes', async () => {
    await motoristaPronto();
    clock += 3 * H;
    await erro(svc.updateProfile(caio, { driverOnline: true }), 'face_check_required');
  });

  test('outra pessoa dirigindo: offline na hora e a equipe confere', async () => {
    await motoristaPronto();
    await svc.updateProfile(caio, { driverOnline: true });
    clock += 2 * H + 1;
    const r = await svc.submitFaceCheck(caio, 'image/jpeg', foto('irmao').dataBase64);
    assert.equal(r.result, 'bloqueado');
    const p = await perfil(caio);
    assert.equal(p.driverOnline, false);
    assert.equal(p.faceBlocked, true);
    await erro(svc.updateProfile(caio, { driverOnline: true }), 'face_blocked');
    const fila = await svc.listFaceReviews(admin);
    assert.equal(fila.length, 1);
    assert.equal(fila[0].result, 'bloqueado');
    const img = await svc.faceReviewImage(admin, fila[0].id, 'selfie');
    assert.equal(Buffer.from(img.bytes).toString(), 'irmao');
    await erro(svc.listFaceReviews(caio), 'forbidden');
    // Equipe confere e libera (era ele mesmo, por exemplo, de boné e luz ruim).
    await svc.resolveFaceReview(admin, fila[0].id, 'liberar');
    assert.equal((await perfil(caio)).faceBlocked, false);
    await svc.updateProfile(caio, { driverOnline: true });
  });

  test('foto sem rosto pede de novo; na 3ª seguida vai para a equipe e fica offline', async () => {
    await motoristaPronto();
    await svc.updateProfile(caio, { driverOnline: true });
    clock += 2 * H + 1;
    assert.equal((await svc.submitFaceCheck(caio, 'image/jpeg', foto('sem-rosto').dataBase64)).result, 'repetir');
    assert.equal((await svc.submitFaceCheck(caio, 'image/jpeg', foto('escura').dataBase64)).result, 'repetir');
    assert.equal((await perfil(caio)).driverOnline, true, 'ainda online, só repetindo');
    assert.equal((await svc.submitFaceCheck(caio, 'image/jpeg', foto('sem-rosto-2').dataBase64)).result, 'revisao');
    assert.equal((await perfil(caio)).driverOnline, false);
  });

  test('IA fora do ar: libera o trabalho, mas a equipe confere a selfie depois', async () => {
    await motoristaPronto();
    clock += 2 * H + 1;
    iaFora = true;
    assert.equal((await svc.submitFaceCheck(caio, 'image/jpeg', foto('caio').dataBase64)).result, 'aprovado');
    assert.equal((await svc.listFaceReviews(admin))[0].result, 'sem_ia');
  });

  test('o intervalo é de 2 horas', () => {
    assert.equal(FACE_CHECK_EVERY_MS, 2 * H);
  });
});

describe('quem pode ver a foto de perfil', () => {
  test('a própria pessoa, a equipe e quem tem viagem com ela', async () => {
    await motoristaPronto();
    await svc.uploadProfilePhoto(ana, 'image/jpeg', foto('ana').dataBase64);
    await erro(svc.profilePhoto(caio, ana.uid), 'forbidden');
    assert.equal(Buffer.from((await svc.profilePhoto(ana, ana.uid)).bytes).toString(), 'ana');
    await svc.profilePhoto(admin, ana.uid);
    await store.update('users', ana.uid, { balanceCents: 10000 });
    await svc.updateProfile(caio, { driverOnline: true });
    const ride = await svc.createRide(ana, { ...SP, categoryId: 'froc_x' });
    await svc.rideAction(caio, ride.id, { action: 'driver_accept' });
    assert.equal(Buffer.from((await svc.profilePhoto(ana, caio.uid)).bytes).toString(), 'caio', 'passageira vê a foto do motorista');
    assert.equal(Buffer.from((await svc.profilePhoto(caio, ana.uid)).bytes).toString(), 'ana');
  });
});
