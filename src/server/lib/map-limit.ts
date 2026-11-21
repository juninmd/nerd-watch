/**
 * Concorrência limitada para fan-out de addons.
 *
 * Com vários addons instalados, a página do título disparava todas as requisições de uma vez: uma
 * rajada que alguns addons tratam como abuso (o de torrent responde 429) e que segura sockets do app
 * local. Aqui a ordem do resultado é preservada; o que muda é só quantas ficam em voo.
 */
export const mapLimit = async <T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> => {
  const size = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : Math.max(1, items.length);
  const out = new Array<R>(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await fn(items[index] as T, index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
};
