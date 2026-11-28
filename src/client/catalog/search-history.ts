/** Buscas recentes deste navegador (o "recent searches" do stream-goat). Núcleo puro + leitura/escrita segura. */
const KEY = 'nw.search.recent';
export const RECENT_MAX = 8;

/** A busca mais nova vai para o topo; repetida (sem caixa/acento extra) não duplica. */
export const pushRecent = (list: string[], query: string, max = RECENT_MAX): string[] => {
  const q = query.trim();
  if (!q) return list;
  const lower = q.toLocaleLowerCase('pt-BR');
  return [q, ...list.filter((x) => x.toLocaleLowerCase('pt-BR') !== lower)].slice(0, max);
};

export const readRecent = (): string[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
};

export const saveRecent = (list: string[]): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Sem storage: só não lembra das buscas.
  }
};

export const rememberSearch = (query: string): string[] => {
  const next = pushRecent(readRecent(), query);
  saveRecent(next);
  return next;
};
