/**
 * Camada de dados do Froc X Uber.
 *
 * As regras de negócio (server/services.ts) só conhecem esta interface. Em produção ela é
 * o Firestore (server/firestoreStore.ts); nos testes, a MemoryStore abaixo. Assim cada regra
 * de dinheiro e de permissão é testada de verdade sem precisar de internet.
 */

export type Doc = Record<string, unknown>;
export type Filter = [field: string, op: '==', value: unknown];

export interface Tx {
  get<T extends Doc>(collection: string, id: string): Promise<T | null>;
  set(collection: string, id: string, data: Doc): void;
  update(collection: string, id: string, data: Doc): void;
}

export interface Store {
  get<T extends Doc>(collection: string, id: string): Promise<T | null>;
  set(collection: string, id: string, data: Doc): Promise<void>;
  update(collection: string, id: string, data: Doc): Promise<void>;
  /** Consulta só por igualdade (sem índices compostos); a ordenação é feita em memória. */
  query<T extends Doc>(collection: string, filters: Filter[], limit?: number): Promise<T[]>;
  count(collection: string, filters: Filter[]): Promise<number>;
  /** Leituras e escritas atômicas: ou tudo acontece, ou nada (dinheiro nunca fica pela metade). */
  transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R>;
}

const clone = <T>(value: T): T => (value == null ? value : structuredClone(value));

export class MemoryStore implements Store {
  data = new Map<string, Map<string, Doc>>();

  private col(name: string) {
    let c = this.data.get(name);
    if (!c) {
      c = new Map();
      this.data.set(name, c);
    }
    return c;
  }

  async get<T extends Doc>(collection: string, id: string): Promise<T | null> {
    return clone((this.col(collection).get(id) as T | undefined) ?? null);
  }

  async set(collection: string, id: string, data: Doc) {
    this.col(collection).set(id, clone(data));
  }

  async update(collection: string, id: string, data: Doc) {
    const current = this.col(collection).get(id);
    if (!current) throw new Error(`not_found:${collection}/${id}`);
    this.col(collection).set(id, { ...current, ...clone(data) });
  }

  async query<T extends Doc>(collection: string, filters: Filter[], limit = 200): Promise<T[]> {
    const out: T[] = [];
    for (const doc of this.col(collection).values()) {
      if (filters.every(([field, , value]) => doc[field] === value)) out.push(clone(doc) as T);
      if (out.length >= limit) break;
    }
    return out;
  }

  async count(collection: string, filters: Filter[]) {
    return (await this.query(collection, filters, Number.MAX_SAFE_INTEGER)).length;
  }

  private queue: Promise<unknown> = Promise.resolve();

  /** Transações em fila: simula o isolamento do Firestore. */
  async transaction<R>(fn: (tx: Tx) => Promise<R>): Promise<R> {
    const run = async () => {
      const writes: Array<() => void> = [];
      const tx: Tx = {
        // Igual ao Firestore: depois de gravar, não pode mais ler na mesma transação.
        get: (c, id) => {
          if (writes.length) throw new Error(`Leitura depois de escrita na transação (${c}/${id}): o Firestore recusa isso.`);
          return this.get(c, id);
        },
        set: (c, id, d) => {
          writes.push(() => this.col(c).set(id, clone(d)));
        },
        update: (c, id, d) => {
          writes.push(() => {
            const current = this.col(c).get(id);
            if (!current) throw new Error(`not_found:${c}/${id}`);
            this.col(c).set(id, { ...current, ...clone(d) });
          });
        },
      };
      const result = await fn(tx);
      for (const w of writes) w();
      return result;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
