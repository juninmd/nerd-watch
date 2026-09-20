/** Cache TTL em memória p/ chamadas a APIs externas (TMDB, Archive.org, OpenSubtitles) — reduz latência e uso de cota. Erros nunca são cacheados. */
const MAX_ENTRIES = 500;

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export const withCache = <Args extends unknown[], T>(
  ttlMs: number,
  fn: (...args: Args) => Promise<T>,
  keyFn: (...args: Args) => string = (...args) => JSON.stringify(args),
): ((...args: Args) => Promise<T>) => {
  const store = new Map<string, Entry<T>>();

  return async (...args: Args): Promise<T> => {
    const key = keyFn(...args);
    const hit = store.get(key);
    const now = Date.now();
    if (hit && hit.expiresAt > now) return hit.value;

    const value = await fn(...args);
    if (store.size >= MAX_ENTRIES) {
      const oldest = store.keys().next().value;
      if (oldest !== undefined) store.delete(oldest);
    }
    store.set(key, { value, expiresAt: now + ttlMs });
    return value;
  };
};
