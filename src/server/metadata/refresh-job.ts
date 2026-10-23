import { config } from '../config.ts';
import { TmdbRequestError } from '../providers/tmdb.ts';
import type { TitleRow } from '../types.ts';
import { needsRefresh } from './refresh-policy.ts';

/** Primeira pausa depois de um erro transitório; dobra a cada falha seguida até o teto. */
export const BACKOFF_BASE_MS = 60_000;
export const BACKOFF_MAX_MS = 60 * 60_000;
/** Título que a TMDB responde 404 (sumiu ou mudou de id): fica de fora por esse tempo, para não ocupar a vaga do tick. */
export const TITLE_REST_MS = 6 * 60 * 60_000;

/** Estado que sobrevive entre ticks (só em memória: um restart zera, o que é aceitável). */
export interface RefreshState {
  /** Falhas transitórias seguidas (zera no primeiro tick sem elas). */
  failures: number;
  /** Nenhum tick chama a TMDB antes deste instante (epoch ms). */
  retryAt: number;
  /** Título id → instante (epoch ms) até o qual ele é pulado. */
  skipUntil: Map<string, number>;
  /** Título id → 5xx seguidos desse título; ao chegar a 3 ele sai da fila por TITLE_REST_MS. */
  serverErrors: Map<string, number>;
}

/** 5xx seguidos de um mesmo título antes de pulá-lo: um título "venenoso" não pode travar a fila inteira. */
export const SERVER_ERRORS_BEFORE_REST = 3;

export const newBackoff = (): RefreshState => ({ failures: 0, retryAt: 0, skipUntil: new Map(), serverErrors: new Map() });

export const backoffDelayMs = (failures: number): number => Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);

/**
 * Tudo que não é "esse título não existe" é transitório: 429, 5xx, 401/403 (chave ruim), falha de rede ou timeout.
 * Nesses casos a rodada inteira para e espera, em vez de martelar a TMDB título por título.
 */
const isTitleNotFound = (err: unknown): boolean => err instanceof TmdbRequestError && err.status === 404;

/** Mensagem curta para log, sem a chave da TMDB (que pode aparecer em URL de erro de rede). */
export const describeError = (err: unknown, secrets: Array<string | undefined> = [config.tmdb.apiKey]): string => {
  let text = err instanceof Error ? err.message : String(err);
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redigida]');
  return text.slice(0, 200);
};

export interface TickDeps {
  /** Títulos candidatos, do refresh mais antigo para o mais recente. */
  listCandidates: () => TitleRow[];
  refresh: (title: TitleRow) => Promise<unknown>;
  now: () => Date;
  /** Teto de títulos atualizados por tick: a cota da TMDB não é infinita. */
  maxPerTick: number;
  log: (message: string) => void;
}

export interface TickSummary {
  status: 'ran' | 'backoff';
  attempted: number;
  refreshed: number;
  failed: number;
}

/**
 * Um tick: atualiza, em sequência, até `maxPerTick` títulos vencidos. Erro transitório encerra o tick e abre
 * backoff; 404 de um título só o deixa de fora por um tempo. Não lança: quem chama não precisa de try/catch.
 */
export const runRefreshTick = async (deps: TickDeps, state: RefreshState): Promise<TickSummary> => {
  const now = deps.now();
  const nowMs = now.getTime();
  if (nowMs < state.retryAt) return { status: 'backoff', attempted: 0, refreshed: 0, failed: 0 };

  const due = deps
    .listCandidates()
    .filter((t) => (state.skipUntil.get(t.id) ?? 0) <= nowMs && needsRefresh(t, now))
    .slice(0, deps.maxPerTick);

  let refreshed = 0;
  let failed = 0;
  for (const title of due) {
    try {
      await deps.refresh(title);
      refreshed++;
      state.serverErrors.delete(title.id);
    } catch (err) {
      failed++;
      if (isTitleNotFound(err)) {
        state.skipUntil.set(title.id, nowMs + TITLE_REST_MS);
        deps.log(`metadados: ${title.title} não encontrado na TMDB, pulado por 6 h (${describeError(err)})`);
        continue;
      }
      if (err instanceof TmdbRequestError && err.status >= 500) {
        const strikes = (state.serverErrors.get(title.id) ?? 0) + 1;
        if (strikes >= SERVER_ERRORS_BEFORE_REST) {
          state.serverErrors.delete(title.id);
          state.skipUntil.set(title.id, nowMs + TITLE_REST_MS);
          deps.log(`metadados: ${title.title} falhou ${strikes} vezes seguidas, pulado por 6 h (${describeError(err)})`);
        } else {
          state.serverErrors.set(title.id, strikes);
        }
      }
      state.failures++;
      state.retryAt = nowMs + backoffDelayMs(state.failures);
      deps.log(`metadados: TMDB indisponível (${describeError(err)}), nova tentativa após ${new Date(state.retryAt).toISOString()}`);
      return { status: 'ran', attempted: refreshed + failed, refreshed, failed };
    }
  }

  state.failures = 0;
  return { status: 'ran', attempted: refreshed + failed, refreshed, failed };
};

export interface JobOptions {
  /** Falso (ex.: sem TMDB_API_KEY): nenhum tick é agendado. */
  enabled: boolean;
  intervalMs: number;
  initialDelayMs: number;
  tick: () => Promise<unknown>;
  log: (message: string) => void;
}

export interface JobHandle {
  stop: () => void;
}

/**
 * Laço com setTimeout encadeado: o próximo tick só é agendado depois que o atual termina, então ticks nunca se
 * sobrepõem. Erro do tick é logado e o laço segue. `unref` para o timer não impedir o processo de encerrar.
 */
export const startRefreshJob = (opts: JobOptions): JobHandle => {
  if (!opts.enabled) return { stop: () => {} };

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    timer = setTimeout(() => void run(), delayMs);
    timer.unref();
  };

  const run = async (): Promise<void> => {
    try {
      await opts.tick();
    } catch (err) {
      opts.log(`metadados: rodada falhou (${describeError(err)})`);
    }
    schedule(opts.intervalMs);
  };

  schedule(opts.initialDelayMs);
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
};
