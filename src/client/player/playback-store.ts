/** Posição salva de cada vídeo (só neste navegador). Regras puras e armazenamento injetável para serem testáveis. */

/** O que a lista "continuar assistindo" precisa para mostrar o vídeo sem consultar o canal de novo. */
export interface ResumeMeta {
  title: string;
  subtitle: string;
  poster: string | null;
  channelId: string;
  messageId: string;
  /** Para onde "continuar" leva; registros antigos não têm e caem na tela do canal. */
  route?: string;
}

export interface StoredPosition {
  seconds: number;
  duration: number | null;
  at: number;
  meta?: ResumeMeta;
  /** Assistiu até o fim: some de "continuar", mas fica marcado como assistido. */
  done?: boolean;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const STORAGE_KEY = 'nw.playback';
/** Cache local: só as posições mais recentes (o servidor guarda bem mais). */
export const MAX_ENTRIES = 200;
/** Menos que isso não vale retomar; mais que a fração final conta como "terminou". */
export const RESUME_MIN_SECONDS = 10;
export const FINISHED_RATIO = 0.95;

export const isFinished = (seconds: number, duration: number | null): boolean => duration !== null && duration > 0 && seconds / duration >= FINISHED_RATIO;

/** Onde retomar, ou null quando começar do início é o certo (quase nada assistido ou já terminou). */
export const resumePoint = (p: StoredPosition | undefined): number | null => {
  if (!p || p.seconds < RESUME_MIN_SECONDS || isFinished(p.seconds, p.duration)) return null;
  return Math.floor(p.seconds);
};

/**
 * Posição inicial de um vídeo: um `t` de link só avança; nunca volta atrás do que já está salvo.
 * Assim um link velho/estranho não apaga o progresso, mas um ponto mais adiante ainda vale.
 */
export const startPoint = (saved: number | null, requested: number | null): number | null => {
  const current = typeof saved === 'number' && Number.isFinite(saved) && saved >= 0 ? saved : null;
  const next = typeof requested === 'number' && Number.isFinite(requested) && requested >= 0 ? requested : null;
  return next !== null && (current === null || next > current) ? next : current;
};

export interface StartInput {
  saved: number | null;
  done?: boolean;
  requested?: number | null;
  /** Duração conhecida (item ou posição salva); quando ausente, o player confere no `loadedmetadata`. */
  duration?: number | null;
}

export interface StartResolution {
  resumeAt: number | null;
  /** Ponto de link aplicado; `null` quando o `t` foi ignorado (assistido, perto do fim ou fora do vídeo). */
  linkAt: number | null;
}

/**
 * Decide o ponto de partida de uma vez, inclusive o que fazer com um `t` que não deve ser aplicado:
 * vídeo já assistido, `t` além da duração ou colado no fim (não pode marcar como assistido só por abrir).
 */
export const resolveStart = ({ saved, done = false, requested = null, duration = null }: StartInput): StartResolution => {
  const base = typeof saved === 'number' && Number.isFinite(saved) && saved >= 0 ? saved : null;
  const link = !done && typeof requested === 'number' && Number.isFinite(requested) && requested >= 0 ? requested : null;
  const chosen = startPoint(base, link);
  if (chosen === null) return { resumeAt: null, linkAt: null };

  if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
    const safeBase = base !== null && base < duration ? base : null;
    if (chosen >= duration) return { resumeAt: safeBase, linkAt: null };
    if (link !== null && chosen === link && isFinished(chosen, duration)) return { resumeAt: safeBase, linkAt: null };
  }
  return { resumeAt: chosen, linkAt: link !== null && chosen === link ? link : null };
};

/** Avisado a cada gravação do usuário (não a reescrita feita pela sincronização). */
export type PlaybackWriteHook = (key: string, op: 'put' | 'delete') => void;

export const createPlaybackStore = (storage: StorageLike, now: () => number = Date.now, onWrite?: PlaybackWriteHook) => {
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
    entries: (): Record<string, StoredPosition> => read(),
    /** Substitui o conteúdo todo (usado pela sincronização). Não dispara `onWrite`. */
    replaceAll: (map: Record<string, StoredPosition>): void => write({ ...map }),
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
      onWrite?.(key, 'put');
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
    /** Tira da lista "continuar" tudo que está em andamento; vídeos assistidos até o fim mantêm a marca. */
    clearInProgress: (): number => {
      const map = read();
      const keys = Object.keys(map).filter((k) => resumePoint(map[k]) !== null);
      for (const k of keys) delete map[k];
      if (keys.length === 0) return 0;
      write(map);
      for (const k of keys) onWrite?.(k, 'delete');
      return keys.length;
    },
    clear: (key: string): void => {
      const map = read();
      delete map[key];
      write(map);
      onWrite?.(key, 'delete');
    },
  };
};
