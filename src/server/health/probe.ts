/** Mede a latência das fontes públicas sem chave. Rede e relógio entram por parâmetro, para testar sem internet. */

export interface SourceProbe {
  id: 'tvmaze' | 'anilist';
  label: string;
  ok: boolean;
  /** Milissegundos até a resposta; `null` quando falhou. */
  ms: number | null;
}

type Fetcher = (url: string, init: RequestInit) => Promise<{ ok: boolean }>;

const TARGETS = [
  { id: 'tvmaze', label: 'TVmaze', url: 'https://api.tvmaze.com/updates/shows?since=day', init: { method: 'HEAD' } },
  {
    id: 'anilist',
    label: 'AniList',
    url: 'https://graphql.anilist.co',
    init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"query":"{__typename}"}' },
  },
] as const;

const TIMEOUT_MS = 4000;

export const probeSources = async (
  fetcher: Fetcher = fetch,
  now: () => number = performance.now.bind(performance),
): Promise<SourceProbe[]> =>
  Promise.all(
    TARGETS.map(async (t): Promise<SourceProbe> => {
      const start = now();
      try {
        const res = await fetcher(t.url, { ...t.init, signal: AbortSignal.timeout(TIMEOUT_MS) });
        return { id: t.id, label: t.label, ok: res.ok, ms: res.ok ? Math.round(now() - start) : null };
      } catch {
        return { id: t.id, label: t.label, ok: false, ms: null };
      }
    }),
  );

/** Guarda o último resultado por 60 s: abrir o Início várias vezes não vira rajada contra serviços de terceiros. */
export const cachedProbe = (probe: () => Promise<SourceProbe[]>, now: () => number = Date.now, ttlMs = 60_000) => {
  let at = 0;
  let value: SourceProbe[] | null = null;
  let pending: Promise<SourceProbe[]> | null = null;
  return async (): Promise<SourceProbe[]> => {
    if (value && now() - at < ttlMs) return value;
    pending ??= probe()
      .then((v) => {
        value = v;
        at = now();
        return v;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
};
