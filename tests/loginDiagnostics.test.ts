import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainTokenError, firebaseDiagnostics } from '../server/firebase.ts';

test('Token de outro projeto vira erro de configuração (não "sessão expirada")', () => {
  const r = explainTokenError(new Error('Firebase ID token has incorrect "aud" (audience) claim. Expected "a" but got "b".'));
  assert.equal(r.reason, 'project_mismatch');
  assert.equal(r.status, 503);
  assert.equal(explainTokenError({ code: 'auth/id-token-expired', message: 'x' }).status, 401);
});

test('Diagnóstico compara o projeto da chave com o da configuração web, sem segredos', async () => {
  const before = { ...process.env };
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({ type: 'service_account', project_id: 'proj-a', client_email: 'firebase-adminsdk-x@proj-a.iam.gserviceaccount.com', private_key: 'nada' });
  process.env.FIREBASE_WEB_CONFIG = JSON.stringify({ apiKey: 'k', projectId: 'proj-b' });
  try {
    const d = await firebaseDiagnostics();
    assert.equal(d.serviceAccountProject, 'proj-a');
    assert.equal(d.webProject, 'proj-b');
    assert.equal(d.sameProject, false);
    assert.equal(d.keyProblem, 'private_key ausente ou cortada');
    assert.ok(!JSON.stringify(d).includes('nada'));
  } finally {
    process.env = before;
  }
});
