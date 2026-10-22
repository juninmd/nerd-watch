/** Posição salva de cada vídeo (só neste navegador). Regras puras e armazenamento injetável para serem testáveis. */

/** O que a lista "continuar assistindo" precisa para mostrar o vídeo sem consultar o canal de novo. */
export interface ResumeMeta {
  title: string;
  subtitle: string;
  poster: string | null;
  channelId: string;
  messageId: string;
}

export interface StoredPosition {
  seconds: number;
  duration: number | null;
  at: number;
  meta?: ResumeMeta;
  /** Assistiu até o fim: some de "continuar", mas fica marcado como assistido. */
  done?: boolean;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const STORAGE_KEY = 'nw.playback';
const MAX_ENTRIES = 200;
/** Menos que isso não vale retomar; mais que a fração final conta como "terminou". */
export const RESUME_MIN_SECONDS = 10;
export const FINISHED_RATIO = 0.95;

export const isFinished = (seconds: number, duration: number | null): boolean => duration !== null && duration > 0 && seconds / duration >= FINISHED_RATIO;

/** Onde retomar, ou null quando começar do início é o certo (quase nada assistido ou já terminou). */
export const resumePoint = (p: StoredPosition | undefined): number | null => {
  if (!p || p.seconds < RESUME_MIN_SECONDS || isFinished(p.seconds, p.duration)) return null;
  return Math.floor(p.seconds);
};

export const createPlaybackStore = (storage: StorageLike, now: () => number = Date.now) => {
  const read = (): Record<string, StoredPosition> => {
    try {
      const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}');
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, StoredPosition>) : {};
    } catch {
      return {};
    }
  };

  const write = (map: Record<string, StoredPosition>): void => {
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      const oldest = keys.sort((a, b) => (map[a]?.at ?? 0) - (map[b]?.at ?? 0)).slice(0, keys.length - MAX_ENTRIES);
      for (const k of oldest) delete map[k];
    }
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
      // cota cheia ou armazenamento bloqueado: perder a posição é aceitável, quebrar o player não
    }
  };

  return {
    get: (key: string): StoredPosition | undefined => read()[key],
    save: (key: string, seconds: number, duration: number | null, meta?: ResumeMeta): void => {
      if (!Number.isFinite(seconds) || seconds < 0) return;
      const map = read();
      // Abrir de novo um vídeo já assistido não apaga a marca de assistido.
      if (map[key]?.done && seconds < RESUME_MIN_SECONDS) return;
      const entry: StoredPosition = { seconds, duration, at: now() };
      if (meta) entry.meta = meta;
      if (isFinished(seconds, duration)) entry.done = true;
      map[key] = entry;
      write(map);
    },
    /** Vídeos começados e não terminados, o último assistido primeiro. */
    inProgress: (limit = 12): Array<{ key: string; position: StoredPosition; meta: ResumeMeta; resumeAt: number }> =>
      Object.entries(read())
        .flatMap(([key, position]) => {
          const resumeAt = resumePoint(position);
          return position.meta && resumeAt !== null ? [{ key, position, meta: position.meta, resumeAt }] : [];
        })
        .sort((a, b) => b.position.at - a.position.at)
        .slice(0, limit),
    clear: (key: string): void => {
      const map = read();
      delete map[key];
      write(map);
    },
  };
};
