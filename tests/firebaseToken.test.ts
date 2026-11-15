import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createTokenVerifier } from '../server/firebaseToken.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const NOW = 1_800_000_000;
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

function makeToken(claims: Record<string, unknown>, kid = 'k1', key = privateKey) {
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64({
    aud: 'proj-a',
    iss: 'https://securetoken.google.com/proj-a',
    sub: 'uid-1',
    iat: NOW - 10,
    exp: NOW + 3000,
    auth_time: NOW - 10,
    email: 'dono@froc.com',
    email_verified: true,
    ...claims,
  });
  const sig = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `${head}.${body}.${sig}`;
}

const verifier = () =>
  createTokenVerifier({ projectId: 'proj-a', nowSeconds: () => NOW, fetchCerts: async () => ({ certs: { k1: pem }, maxAgeSeconds: 3600 }) });

test('Token válido do Firebase é aceito sem o firebase-admin/auth', async () => {
  const d = await verifier()(makeToken({}));
  assert.equal(d.uid, 'uid-1');
  assert.equal(d.email, 'dono@froc.com');
  assert.equal(d.email_verified, true);
});

test('Token expirado, de outro projeto, adulterado ou com chave desconhecida é recusado', async () => {
  const v = verifier();
  await assert.rejects(v(makeToken({ exp: NOW - 1 })), (e: Error & { code?: string }) => e.code === 'auth/id-token-expired');
  await assert.rejects(v(makeToken({ aud: 'proj-b', iss: 'https://securetoken.google.com/proj-b' })), /aud/);
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  await assert.rejects(v(makeToken({}, 'k1', other)), /Assinatura/);
  await assert.rejects(v(makeToken({}, 'k9')), /desconhecida/);
  const [h, , s] = makeToken({}).split('.');
  await assert.rejects(v(`${h}.${b64({ aud: 'proj-a', iss: 'https://securetoken.google.com/proj-a', sub: 'hacker', iat: NOW, exp: NOW + 99 })}.${s}`), /Assinatura/);
  await assert.rejects(v('abc'), /mal formado/);
});
