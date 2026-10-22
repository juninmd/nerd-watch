/** Posição salva de cada vídeo (só neste navegador). Regras puras e armazenamento injetável para serem testáveis. */

export interface StoredPosition {
  seconds: number;
  duration: number | null;
  at: number;
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
    save: (key: string, seconds: number, duration: number | null): void => {
      if (!Number.isFinite(seconds) || seconds < 0) return;
      const map = read();
      if (isFinished(seconds, duration)) delete map[key];
      else map[key] = { seconds, duration, at: now() };
      write(map);
    },
    clear: (key: string): void => {
      const map = read();
      delete map[key];
      write(map);
    },
  };
};
