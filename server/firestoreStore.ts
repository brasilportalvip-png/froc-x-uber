import type { Doc, Filter, Order, Store, Tx } from './store.ts';

/**
 * Implementação da Store no Firestore (produção). Recebe a instância do Firestore do
 * firebase-admin já inicializada (server/firebase.ts).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Firestore = any;

const strip = (data: Doc): Doc => JSON.parse(JSON.stringify(data)) as Doc; // Firestore recusa undefined

export class FirestoreStore implements Store {
  db: Firestore;
  prefix: string;

  /** prefix: separa as coleções do Froc de outros apps no mesmo projeto (ex.: "froc_"). */
  constructor(db: Firestore, prefix = '') {
    this.db = db;
    this.prefix = prefix;
  }

  private col(name: string) {
    return this.db.collection(this.prefix + name);
  }

  async get<T extends Doc>(collection: string, id: string): Promise<T | null> {
    const snap = await this.col(collection).doc(id).get();
    return snap.exists ? (snap.data() as T) : null;
  }

  async set(collection: string, id: string, data: Doc) {
    await this.col(collection).doc(id).set(strip(data));
  }

  async update(collection: string, id: string, data: Doc) {
    await this.col(collection).doc(id).update(strip(data));
  }

  async remove(collection: string, id: string) {
    await this.col(collection).doc(id).delete();
  }

  private warned = new Set<string>();

  async query<T extends Doc>(collection: string, filters: Filter[], limit = 200, order?: Order): Promise<T[]> {
    let q = this.col(collection);
    for (const [field, op, value] of filters) q = q.where(field, op, value);
    if (order) {
      try {
        const snap = await q.orderBy(order.field, order.dir).limit(limit).get();
        return snap.docs.map((d: { data(): Doc }) => d.data() as T);
      } catch (e) {
        // Índice ainda não publicado (FAILED_PRECONDITION): ordena aqui mesmo, sem derrubar a tela.
        const code = (e as { code?: unknown })?.code;
        if (code !== 9 && code !== 'failed-precondition' && !/index/i.test(String((e as Error)?.message))) throw e;
        const key = `${collection}:${filters.map((f) => f[0]).join(',')}:${order.field}`;
        if (!this.warned.has(key)) {
          this.warned.add(key);
          console.warn(`Índice do Firestore faltando para ${key} (rode PUBLICAR-FIREBASE.cmd). Ordenando no servidor.`);
        }
        const snap = await q.limit(Math.max(limit, 500)).get();
        const sign = order.dir === 'desc' ? -1 : 1;
        return (snap.docs.map((d: { data(): Doc }) => d.data()) as T[])
          .filter((d) => d[order.field] !== undefined && d[order.field] !== null)
          .sort((a, b) => sign * String(a[order.field]).localeCompare(String(b[order.field])))
          .slice(0, limit);
      }
    }
    const snap = await q.limit(limit).get();
    return snap.docs.map((d: { data(): Doc }) => d.data() as T);
  }

  async count(collection: string, filters: Filter[]) {
    let q = this.col(collection);
    for (const [field, op, value] of filters) q = q.where(field, op, value);
    const snap = await q.count().get();
    return Number(snap.data().count || 0);
  }

  async transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R> {
    return this.db.runTransaction(async (t: Firestore) => {
      const tx: Tx = {
        get: async (c, id) => {
          const snap = await t.get(this.col(c).doc(id));
          return snap.exists ? snap.data() : null;
        },
        set: (c, id, d) => {
          t.set(this.col(c).doc(id), strip(d));
        },
        update: (c, id, d) => {
          t.update(this.col(c).doc(id), strip(d));
        },
      };
      return fn(tx);
    });
  }
}
