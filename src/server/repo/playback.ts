import type { Database } from 'bun:sqlite';

/** Progresso de reprodução (o cliente é local-first; isto é a cópia que sobrevive ao navegador e entra no backup). */
export interface PlaybackMeta {
  title: string;
  subtitle: string;
  poster: string | null;
  channelId: string;
  messageId: string;
  route?: string;
}

export interface PlaybackEntry {
  key: string;
  seconds: number;
  duration: number | null;
  at: number;
  done: boolean;
  meta: PlaybackMeta | null;
}

interface PlaybackRow {
  key: string;
  seconds: number;
  duration: number | null;
  at: number;
  done: number;
  meta: string | null;
}

export class InvalidPlaybackError extends Error {}

/** Teto da tabela: passou disso, descartam-se as posições mais antigas (o cliente guarda só as recentes). */
export const PLAYBACK_MAX_ROWS = 5000;
const KEY_RE = /^[\w:.-]{1,200}$/;
const MAX_SECONDS = 1_000_000;
/** Aceita relógio do cliente um pouco adiantado; um `at` longe no futuro travaria o last-write-wins. */
const FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;
const META_MAX_BYTES = 2048;

const invalid = (msg: string): never => {
  throw new InvalidPlaybackError(msg);
};

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const inRange = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);

export const parsePlaybackKey = (key: unknown): string => {
  // `..` passa no regex (só pontos), então é recusado à parte: a chave nunca deve parecer um caminho.
  if (typeof key !== 'string' || !KEY_RE.test(key) || key.includes('..')) return invalid('chave de posição inválida');
  return key;
};

/** Campos conhecidos apenas; strings truncadas; o resultado tem de caber em 2 KB. */
export const parsePlaybackMeta = (raw: unknown): PlaybackMeta | null => {
  if (raw === null || raw === undefined) return null;
  if (!isPlainObject(raw)) return invalid('meta inválido');
  const title = text(raw.title, 200);
  const channelId = text(raw.channelId, 200);
  const messageId = text(raw.messageId, 100);
  if (!title || !channelId || !messageId) return invalid('meta sem título, canal ou mensagem');
  const meta: PlaybackMeta = {
    title,
    subtitle: text(raw.subtitle, 200) ?? '',
    // miniaturas do Drive/Telegram são URLs assinadas longas: o teto precisa cobri-las inteiras
    poster: text(raw.poster, 1000) || null,
    channelId,
    messageId,
  };
  const route = text(raw.route, 300);
  // Só rota interna: `navigate()` do cliente nunca deve receber um URL externo ou `//host`.
  if (route?.startsWith('/') && !route.startsWith('//')) meta.route = route;
  if (new TextEncoder().encode(JSON.stringify(meta)).length > META_MAX_BYTES) return invalid('meta grande demais');
  return meta;
};

/** Valida uma posição vinda de fora (PUT ou backup). `done` aceita boolean ou 0/1 (formato da linha do SQLite). */
export const parsePlaybackEntry = (key: unknown, raw: unknown, now: number = Date.now()): PlaybackEntry => {
  const k = parsePlaybackKey(key);
  if (!isPlainObject(raw)) return invalid('corpo inválido');
  if (!inRange(raw.seconds, 0, MAX_SECONDS)) return invalid('seconds fora da faixa 0..1000000');
  if (raw.duration !== undefined && raw.duration !== null && !inRange(raw.duration, 0, MAX_SECONDS)) return invalid('duration fora da faixa');
  if (!Number.isSafeInteger(raw.at) || (raw.at as number) < 0 || (raw.at as number) > now + FUTURE_SKEW_MS) return invalid('at inválido ou no futuro');
  if (raw.done !== undefined && typeof raw.done !== 'boolean' && raw.done !== 0 && raw.done !== 1) return invalid('done inválido');
  return {
    key: k,
    seconds: raw.seconds,
    duration: typeof raw.duration === 'number' ? raw.duration : null,
    at: raw.at as number,
    done: raw.done === true || raw.done === 1,
    meta: parsePlaybackMeta(raw.meta),
  };
};

const toEntry = (row: PlaybackRow): PlaybackEntry => {
  let meta: PlaybackMeta | null = null;
  try {
    meta = row.meta ? (JSON.parse(row.meta) as PlaybackMeta) : null;
  } catch {
    meta = null;
  }
  return { key: row.key, seconds: row.seconds, duration: row.duration, at: row.at, done: row.done === 1, meta };
};

/**
 * Last-write-wins por `at`: uma gravação mais antiga que a já guardada é ignorada (um aparelho com relógio ou
 * fila atrasada não pode regredir a posição). Devolve se a gravação foi aplicada.
 */
export const upsertPlaybackEntry = (db: Database, e: PlaybackEntry): boolean =>
  db.transaction((): boolean => {
    const current = db.query<{ at: number }, [string]>('SELECT at FROM playback_positions WHERE key = ?').get(e.key);
    if (current && current.at > e.at) return false;
    db.query(
      `INSERT INTO playback_positions (key, seconds, duration, at, done, meta)
       VALUES ($key, $seconds, $duration, $at, $done, $meta)
       ON CONFLICT (key) DO UPDATE SET
         seconds = excluded.seconds, duration = excluded.duration, at = excluded.at, done = excluded.done, meta = excluded.meta`,
    ).run({
      $key: e.key,
      $seconds: e.seconds,
      $duration: e.duration,
      $at: e.at,
      $done: e.done ? 1 : 0,
      $meta: e.meta ? JSON.stringify(e.meta) : null,
    });
    db.exec(`DELETE FROM playback_positions WHERE key IN (SELECT key FROM playback_positions ORDER BY at DESC LIMIT -1 OFFSET ${PLAYBACK_MAX_ROWS})`);
    // A gravação mais antiga do teto cai no próprio prune: dizer "aplicada" faria o cliente achar que ela está no servidor.
    return db.query('SELECT 1 FROM playback_positions WHERE key = ?').get(e.key) !== null;
  })();

/** Mais recentes primeiro; `key` desempata para a paginação ser estável. */
export const listPlaybackEntries = (db: Database, limit: number, offset: number): PlaybackEntry[] =>
  db
    .query<PlaybackRow, [number, number]>('SELECT * FROM playback_positions ORDER BY at DESC, key ASC LIMIT ? OFFSET ?')
    .all(limit, offset)
    .map(toEntry);

export const deletePlaybackEntry = (db: Database, key: string): boolean =>
  db.query('DELETE FROM playback_positions WHERE key = ?').run(key).changes > 0;
