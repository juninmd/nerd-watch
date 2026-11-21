/**
 * Cache curto das respostas JSON dos addons.
 *
 * Cada recurso (`catalog`, `meta`, `stream`) é uma requisição HTTP a um serviço de terceiros. Abrir um
 * título, voltar, reabrir o episódio — tudo isso refazia a mesma chamada. O protocolo já diz por quanto
 * tempo a resposta vale (`cacheMaxAge`, em segundos), e o addon de torrent publica 3600. Aqui:
 *
 * - respeita `cacheMaxAge` do corpo, com teto (`MAX_TTL_MS`) — link de debrid não pode ficar velho por
 *   uma hora só porque o addon pediu;
 * - sem o campo (ou com valor inválido), vale o padrão por recurso;
 * - erro **não** entra no cache;
 * - requisições simultâneas para a mesma URL compartilham a mesma promise;
 * - teto de entradas para o processo não crescer com o uso.
 */
export const DEFAULT_TTL_MS = 60_000;
/** Teto: o addon pede 3600 s, mas stream de debrid expira antes disso. */
export const MAX_TTL_MS = 5 * 60_000;
export const MAX_ENTRIES = 200;

interface Entry {
  at: number;
  ttlMs: number;
  value: unknown;
}

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/** Só para teste: cada caso começa sem cache (e o `setAddonFetch` também limpa). */
export const clearAddonCache = (): void => {
  entries.clear();
  inflight.clear();
};

export const addonCacheSize = (): number => entries.size;

/** `cacheMaxAge` (segundos) do corpo, limitado ao teto; valor ausente/zero/lixo cai no padrão. */
export const ttlFromBody = (body: unknown, fallbackMs = DEFAULT_TTL_MS): number => {
  const raw = typeof body === 'object' && body !== null ? (body as { cacheMaxAge?: unknown }).cacheMaxAge : undefined;
  const seconds = typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return fallbackMs;
  return Math.min(Math.floor(seconds * 1000), MAX_TTL_MS);
};

const trim = (): void => {
  if (entries.size <= MAX_ENTRIES) return;
  // Map preserva a ordem de inserção: as mais antigas saem primeiro.
  for (const key of entries.keys()) {
    if (entries.size <= MAX_ENTRIES) break;
    entries.delete(key);
  }
};

export const cachedAddonJson = async (
  url: string,
  fetchJson: (target: string) => Promise<unknown>,
  options: { now?: () => number; ttlMs?: number } = {},
): Promise<unknown> => {
  const now = options.now ?? Date.now;
  const hit = entries.get(url);
  if (hit && now() - hit.at < hit.ttlMs) return hit.value;

  const pending = inflight.get(url);
  if (pending) return pending;

  const task = fetchJson(url).then((value) => {
    entries.set(url, { at: now(), ttlMs: ttlFromBody(value, options.ttlMs ?? DEFAULT_TTL_MS), value });
    trim();
    return value;
  });
  inflight.set(url, task);
  try {
    return await task;
  } finally {
    inflight.delete(url);
  }
};
