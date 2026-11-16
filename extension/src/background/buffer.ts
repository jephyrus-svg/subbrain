// 오프라인 버퍼 = IndexedDB(설계서 5.4①-A). MV3 서비스 워커는 30초쯤 쉬면 꺼지므로 메모리 큐에 기대지 않는다.
// 받은 스냅샷은 먼저 여기 넣고 → 보내고 → 성공하면 지운다. 대화마다 가장 새로운 것 하나만 둔다(계약 §14.3 허용).
import type { IngestSnapshotBody } from '../shared/contract';

export interface BufferEntry { key: string; body: IngestSnapshotBody; capturedAt: string; attempts: number }
export interface SnapshotBuffer {
  put(body: IngestSnapshotBody): Promise<void>;
  remove(key: string, capturedAt?: string): Promise<void>;
  oldest(limit: number): Promise<BufferEntry[]>;
  count(): Promise<number>;
  bump(key: string): Promise<void>;
}
export const bufferKey = (b: Pick<IngestSnapshotBody, 'sourceAi' | 'sourceId'>) => `${b.sourceAi}:${b.sourceId}`;

const DB = 'subbrain-ext'; const STORE = 'snapshots';
function open(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = idb.open(DB, 1);
    r.onupgradeneeded = () => { const s = r.result.createObjectStore(STORE, { keyPath: 'key' }); s.createIndex('capturedAt', 'capturedAt'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const done = (t: IDBTransaction) => new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export function idbBuffer(idb: IDBFactory = indexedDB): SnapshotBuffer {
  let dbp: Promise<IDBDatabase> | null = null;
  const db = () => (dbp ??= open(idb));
  return {
    async put(body) {
      const d = await db(); const t = d.transaction(STORE, 'readwrite'); const s = t.objectStore(STORE);
      const key = bufferKey(body);
      const cur = await req(s.get(key)) as BufferEntry | undefined;
      // 더 새로운 것이 이미 있으면 옛것으로 덮지 않는다
      if (!cur || cur.capturedAt <= body.capturedAt) s.put({ key, body, capturedAt: body.capturedAt, attempts: cur?.attempts ?? 0 } satisfies BufferEntry);
      await done(t);
    },
    async remove(key, capturedAt) {
      const d = await db(); const t = d.transaction(STORE, 'readwrite'); const s = t.objectStore(STORE);
      const cur = await req(s.get(key)) as BufferEntry | undefined;
      // 보내는 사이 더 새로운 스냅샷이 들어왔으면 그건 남긴다
      if (cur && (!capturedAt || cur.capturedAt <= capturedAt)) s.delete(key);
      await done(t);
    },
    async oldest(limit) {
      const d = await db(); const t = d.transaction(STORE, 'readonly');
      const all = await req(t.objectStore(STORE).index('capturedAt').getAll()) as BufferEntry[];
      return all.slice(0, limit);
    },
    async count() { const d = await db(); return req(d.transaction(STORE, 'readonly').objectStore(STORE).count()); },
    async bump(key) {
      const d = await db(); const t = d.transaction(STORE, 'readwrite'); const s = t.objectStore(STORE);
      const cur = await req(s.get(key)) as BufferEntry | undefined; if (cur) s.put({ ...cur, attempts: cur.attempts + 1 });
      await done(t);
    },
  };
}
