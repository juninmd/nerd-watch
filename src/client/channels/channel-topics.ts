export interface TopicInfo {
  topicId: string;
  title: string;
  pinned: boolean;
}

export interface PinInfo {
  messageId: string;
  text: string | null;
  postedAt: string | null;
}

/** Id da aba "Geral": vídeos sem tópico (fora de fórum, ou no tópico Geral do fórum). */
export const GENERAL = 'general';
export const ALL = 'all';

export interface TopicTab {
  id: string;
  title: string;
  pinned: boolean;
  count: number;
}

/**
 * Abas do canal: só existem quando o canal é um fórum (há tópicos, ou vídeo preso a um tópico).
 * Ordem: fixados primeiro, depois pelo id; "Geral" abre a lista; tópico sem nome conhecido vira "Tópico N".
 * Tópicos sem vídeo continuam como aba (contagem 0): o subgrupo existe mesmo antes de ser importado.
 */
export const buildTopicTabs = (items: ReadonlyArray<{ topicId?: string | null }>, topics: readonly TopicInfo[]): TopicTab[] => {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.topicId ?? GENERAL, (counts.get(i.topicId ?? GENERAL) ?? 0) + 1);
  const isForum = topics.length > 0 || [...counts.keys()].some((k) => k !== GENERAL);
  if (!isForum) return [];

  const known = new Map(topics.map((t) => [t.topicId, t]));
  const tabs: TopicTab[] = [];
  if (counts.has(GENERAL)) tabs.push({ id: GENERAL, title: 'Geral', pinned: false, count: counts.get(GENERAL) ?? 0 });
  const extra = [...counts.keys()].filter((k) => k !== GENERAL && !known.has(k)).map((k) => ({ topicId: k, title: `Tópico ${k}`, pinned: false }));
  const rest = [...topics, ...extra].sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(a.topicId) - Number(b.topicId));
  for (const t of rest) tabs.push({ id: t.topicId, title: t.title, pinned: t.pinned, count: counts.get(t.topicId) ?? 0 });
  return tabs;
};

/** Vídeos de uma aba; `ALL` devolve tudo. */
export const itemsInTab = <T extends { topicId?: string | null }>(items: T[], tab: string): T[] =>
  tab === ALL ? items : items.filter((i) => (i.topicId ?? GENERAL) === tab);

/** Em "Todos" os vídeos se agrupam por subgrupo, na ordem das abas; dentro de cada um vale a ordem escolhida. */
export const groupByTab = <T extends { topicId?: string | null }>(items: T[], tabs: readonly TopicTab[]): Array<{ tab: TopicTab; items: T[] }> => {
  const out: Array<{ tab: TopicTab; items: T[] }> = [];
  for (const tab of tabs) {
    const inside = itemsInTab(items, tab.id);
    if (inside.length) out.push({ tab, items: inside });
  }
  return out;
};

/** Link da mensagem no Telegram (canal público `@x` ou privado `c/<id>`). */
export const messageLink = (handle: string, messageId: string): string => `https://t.me/${handle.replace(/^@/, '')}/${messageId}`;
