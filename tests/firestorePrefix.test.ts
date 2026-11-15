import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreStore } from '../server/firestoreStore.ts';

/** Firestore falso só para conferir em qual coleção cada leitura/escrita cai. */
function fakeDb(log: string[]) {
  const doc = (col: string, id: string) => ({
    async get() {
      log.push(`get ${col}/${id}`);
      return { exists: false, data: () => undefined };
    },
    async set() {
      log.push(`set ${col}/${id}`);
    },
  });
  const query = (col: string) => ({
    where: () => query(col),
    limit: () => ({
      async get() {
        log.push(`query ${col}`);
        return { docs: [] };
      },
    }),
  });
  return {
    collection: (col: string) => ({ ...query(col), doc: (id: string) => doc(col, id) }),
  };
}

test('coleções do Froc ficam separadas de outros apps no mesmo projeto Firebase', async () => {
  const log: string[] = [];
  const store = new FirestoreStore(fakeDb(log), 'froc_');
  await store.get('users', 'u1');
  await store.set('rides', 'r1', { a: 1 });
  await store.query('sos', [['status', '==', 'open']]);
  assert.deepEqual(log, ['get froc_users/u1', 'set froc_rides/r1', 'query froc_sos']);
});
