import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrocService, resolvePoint } from '../server/services.ts';
import type { AuthUser } from '../server/services.ts';
import { MemoryStore } from '../server/store.ts';

const city = (name: string, state: string, lat: number, lng: number) => ({ id: `place-${name}`, name: `${name} · ${state}`, city: name, state, zone: 'intercity', lat, lng, kind: 'city' });

test('Qualquer cidade do Brasil é aceita; fora do Brasil é recusada', () => {
  assert.equal(resolvePoint(city('Manaus', 'AM', -3.119, -60.021), '').city, 'Manaus');
  assert.equal(resolvePoint(city('Recife', 'PE', -8.047, -34.877), '').state, 'PE');
  assert.equal(resolvePoint(city('Chuí', 'RS', -33.69, -53.456), '').city, 'Chuí');
  assert.equal(resolvePoint(city('Oiapoque', 'AP', 3.843, -51.835), '').city, 'Oiapoque');
  assert.throws(() => resolvePoint(city('Buenos Aires', 'BA', -34.6, -58.38), ''), /dentro do Brasil/);
  assert.throws(() => resolvePoint(city('Lisboa', 'LX', 38.72, -9.14), ''), /dentro do Brasil/);
});

test('Carona entre cidades do Nordeste e caminhoneiro com RNTRC', async () => {
  const svc = new FrocService(new MemoryStore(), { files: { async save() {}, async signedUrl(p) { return p; } } });
  const admin: AuthUser = { uid: 'adm', email: 'adm@x.com', emailVerified: true };
  const svcAdmin = new FrocService((svc as unknown as { store: MemoryStore }).store, { adminEmails: ['adm@x.com'], files: { async save() {}, async signedUrl(p) { return p; } } });
  const driver: AuthUser = { uid: 'd1', email: 'd@x.com', emailVerified: true };
  const b64 = Buffer.from('foto').toString('base64');
  for (const doc of ['cnh', 'crlv']) await svc.uploadDocument(driver, 'driver', doc, 'image/jpeg', b64);
  await svc.applyAsProvider(driver, 'driver', { phone: '81988887777', vehicle: 'Onix Prata', plate: 'ABC1D23' });
  await svcAdmin.reviewApplication(admin, 'd1', 'driver', 'approved', '');
  const trip = await svc.publishCarpool(driver, {
    originPoint: city('Recife', 'PE', -8.047, -34.877),
    destinationPoint: city('Fortaleza', 'CE', -3.732, -38.527),
    date: '20/12/2026',
    departureTime: '07:30',
    pricePerSeat: 120,
    totalSeats: 3,
  });
  assert.equal(trip.origin.city, 'Recife');
  assert.equal(trip.destination.state, 'CE');
  assert.ok(trip.distanceKm > 500);

  const trucker: AuthUser = { uid: 't1', email: 't@x.com', emailVerified: true };
  for (const doc of ['cnh', 'crlv', 'antt']) await svc.uploadDocument(trucker, 'trucker', doc, 'image/jpeg', b64);
  await assert.rejects(
    svc.applyAsProvider(trucker, 'trucker', { phone: '91988887777', vehicle: 'VW Delivery', plate: 'QWE1R23', truckType: 'Truck Baú' }),
    /RNTRC/,
  );
  const prof = await svc.applyAsProvider(trucker, 'trucker', { phone: '91988887777', vehicle: 'VW Delivery', plate: 'QWE1R23', truckType: 'Truck Baú', rntrc: '0123.4567-8' });
  assert.equal(prof.rntrc, '012345678');
  const overview = await svcAdmin.adminOverview(admin);
  assert.equal(overview.applications.find((a) => a.uid === 't1')?.rntrc, '012345678');
});
