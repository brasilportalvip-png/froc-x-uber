/**
 * Gravação da viagem (áudio ou vídeo) feita no PRÓPRIO celular, pelo navegador.
 *
 * - Nada é enviado para a Froc: os pedaços da gravação ficam no armazenamento do aparelho
 *   (IndexedDB) a cada 4 s. Se o app fechar ou a bateria acabar, a gravação é recuperada
 *   na próxima vez que o app abrir.
 * - Ao parar, o arquivo é entregue para a pessoa salvar (compartilhar/baixar).
 * - Limitação honesta do navegador: só grava com o app aberto na tela. Por isso pedimos
 *   para a tela não apagar (Wake Lock) enquanto grava.
 */

const DB = 'froc-gravacoes';
const STORE = 'pedacos';
const META = 'gravacoes';

export type RecordingMode = 'audio' | 'video';

/** Gravações sendo usadas agora por uma tela (não aparecem no aviso de recuperação). */
export const heldIds = new Set<string>();

export interface SavedRecording {
  id: string;
  mode: RecordingMode;
  mimeType: string;
  startedAt: string;
  tripLabel: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { autoIncrement: true }).createIndex('rec', 'rec');
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => T): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const out = fn(t);
    t.oncomplete = () => {
      db.close();
      resolve(out);
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
  });
}

export function recordingSupported(mode: RecordingMode) {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof indexedDB !== 'undefined' &&
    (mode === 'audio' || 'mediaDevices' in navigator)
  );
}

function pickMime(mode: RecordingMode) {
  const options =
    mode === 'video'
      ? ['video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return options.find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
}

export const extensionFor = (mime: string) => (mime.includes('mp4') ? (mime.startsWith('audio') ? 'm4a' : 'mp4') : mime.includes('ogg') ? 'ogg' : 'webm');

export interface ActiveRecording {
  id: string;
  mode: RecordingMode;
  stream: MediaStream;
  stop: () => Promise<Blob>;
  startedAt: number;
}

/** Começa a gravar. Pede permissão de microfone (e câmera, no vídeo). */
export async function startRecording(mode: RecordingMode, tripLabel: string): Promise<ActiveRecording> {
  const stream = await navigator.mediaDevices.getUserMedia(
    mode === 'video'
      ? { audio: true, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 20 } } }
      : { audio: { echoCancellation: true, noiseSuppression: true } },
  );
  const mimeType = pickMime(mode);
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    ...(mode === 'video' ? { videoBitsPerSecond: 600_000, audioBitsPerSecond: 64_000 } : { audioBitsPerSecond: 48_000 }),
  });
  const id = `rec-${Date.now()}`;
  heldIds.add(id);
  const meta: SavedRecording = { id, mode, mimeType: recorder.mimeType || mimeType || (mode === 'video' ? 'video/webm' : 'audio/webm'), startedAt: new Date().toISOString(), tripLabel };
  await tx([META], 'readwrite', (t) => t.objectStore(META).put(meta));
  let pending = Promise.resolve();
  recorder.ondataavailable = (ev) => {
    if (!ev.data || ev.data.size === 0) return;
    const chunk = ev.data;
    pending = pending.then(() => tx([STORE], 'readwrite', (t) => void t.objectStore(STORE).add({ rec: id, blob: chunk })).catch(() => undefined));
  };
  recorder.start(4000);

  // Mantém a tela acesa durante a gravação (o navegador para de gravar se a tela apagar).
  let wake: { release: () => Promise<void> } | null = null;
  const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
  const requestWake = () => nav.wakeLock?.request('screen').then((w) => (wake = w)).catch(() => undefined);
  void requestWake();
  const onVisible = () => {
    if (document.visibilityState === 'visible') void requestWake();
  };
  document.addEventListener('visibilitychange', onVisible);

  const stop = () =>
    new Promise<Blob>((resolve) => {
      const finish = async () => {
        document.removeEventListener('visibilitychange', onVisible);
        stream.getTracks().forEach((t) => t.stop());
        void wake?.release().catch(() => undefined);
        await pending;
        resolve(await assemble(id));
      };
      if (recorder.state === 'inactive') void finish();
      else {
        recorder.onstop = () => void finish();
        recorder.stop();
      }
    });

  return { id, mode, stream, stop, startedAt: Date.now() };
}

/** Junta os pedaços salvos de uma gravação num arquivo só. */
export async function assemble(id: string): Promise<Blob> {
  const [meta, chunks] = await tx([META, STORE], 'readonly', (t) => {
    const out: { meta: SavedRecording | null; chunks: Blob[] } = { meta: null, chunks: [] };
    const m = t.objectStore(META).get(id);
    m.onsuccess = () => (out.meta = (m.result as SavedRecording) || null);
    const c = t.objectStore(STORE).index('rec').openCursor(IDBKeyRange.only(id));
    c.onsuccess = () => {
      const cur = c.result;
      if (cur) {
        out.chunks.push((cur.value as { blob: Blob }).blob);
        cur.continue();
      }
    };
    return out;
  }).then((o) => [o.meta, o.chunks] as const);
  return new Blob(chunks, { type: meta?.mimeType || 'application/octet-stream' });
}

/** Gravações que ainda não foram salvas pela pessoa (ex.: o app fechou no meio). */
export async function pendingRecordings(): Promise<SavedRecording[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    return await tx([META], 'readonly', (t) => {
      const out: SavedRecording[] = [];
      const c = t.objectStore(META).openCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (cur) {
          if (!heldIds.has((cur.value as SavedRecording).id)) out.push(cur.value as SavedRecording);
          cur.continue();
        }
      };
      return out;
    });
  } catch {
    return [];
  }
}

/** Apaga a gravação do armazenamento do app (depois que a pessoa salvou o arquivo). */
export async function discardRecording(id: string) {
  heldIds.delete(id);
  await tx([META, STORE], 'readwrite', (t) => {
    t.objectStore(META).delete(id);
    const c = t.objectStore(STORE).index('rec').openCursor(IDBKeyRange.only(id));
    c.onsuccess = () => {
      const cur = c.result;
      if (cur) {
        cur.delete();
        cur.continue();
      }
    };
  });
}

export function recordingFileName(meta: Pick<SavedRecording, 'mode' | 'mimeType' | 'startedAt'>) {
  const when = new Date(meta.startedAt).toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(/[: ]/g, '-');
  return `froc-viagem-${meta.mode === 'video' ? 'video' : 'audio'}-${when}.${extensionFor(meta.mimeType)}`;
}

/** Entrega o arquivo para a pessoa: menu de compartilhar do celular (salvar em Arquivos/Galeria) ou download. */
export async function saveToDevice(blob: Blob, fileName: string) {
  const file = new File([blob], fileName, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Gravação da viagem Froc' });
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}
