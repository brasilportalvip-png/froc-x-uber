import type { Doc, Filter, Store, Tx } from './store.ts';

/**
 * Implementação da Store no Firestore (produção). Recebe a instância do Firestore do
 * firebase-admin já inicializada (server/firebase.ts).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Firestore = any;

const strip = (data: Doc): Doc => JSON.parse(JSON.stringify(data)) as Doc; // Firestore recusa undefined

export class FirestoreStore implements Store {
  db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
  }

  async get<T extends Doc>(collection: string, id: string): Promise<T | null> {
    const snap = await this.db.collection(collection).doc(id).get();
    return snap.exists ? (snap.data() as T) : null;
  }

  async set(collection: string, id: string, data: Doc) {
    await this.db.collection(collection).doc(id).set(strip(data));
  }

  async update(collection: string, id: string, data: Doc) {
    await this.db.collection(collection).doc(id).update(strip(data));
  }

  async query<T extends Doc>(collection: string, filters: Filter[], limit = 200): Promise<T[]> {
    let q = this.db.collection(collection);
    for (const [field, op, value] of filters) q = q.where(field, op, value);
    const snap = await q.limit(limit).get();
    return snap.docs.map((d: { data(): Doc }) => d.data() as T);
  }

  async count(collection: string, filters: Filter[]) {
    let q = this.db.collection(collection);
    for (const [field, op, value] of filters) q = q.where(field, op, value);
    const snap = await q.count().get();
    return Number(snap.data().count || 0);
  }

  async transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R> {
    return this.db.runTransaction(async (t: Firestore) => {
      const tx: Tx = {
        get: async (c, id) => {
          const snap = await t.get(this.db.collection(c).doc(id));
          return snap.exists ? snap.data() : null;
        },
        set: (c, id, d) => {
          t.set(this.db.collection(c).doc(id), strip(d));
        },
        update: (c, id, d) => {
          t.update(this.db.collection(c).doc(id), strip(d));
        },
      };
      return fn(tx);
    });
  }
}
