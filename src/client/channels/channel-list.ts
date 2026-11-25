import { ALL, groupByTab, itemsInTab, type TopicTab } from './channel-topics.ts';
import { filterItems, type ItemOrder, orderItems } from './telegram-items.ts';

type ListItem = {
  messageId: string;
  caption: string | null;
  postedAt?: string | null;
  fileName?: string | null;
  topicId?: string | null;
};

export interface ChannelList<T> {
  /** Na ordem escolhida, na aba ativa e já filtrada pela busca: "Reproduzir tudo" e o clique no card usam esta lista. */
  matches: T[];
  /** Cabeçalho de grupo antes do 1º vídeo de cada subgrupo (só em "Todos" com abas), por `messageId`. */
  headings: Map<string, string>;
}

/** Lista de vídeos do canal: em "Todos" os vídeos saem agrupados por subgrupo; cada aba mostra só o seu. */
export const buildChannelList = <T extends ListItem>(items: T[], order: ItemOrder, topic: string, tabs: readonly TopicTab[], q: string): ChannelList<T> => {
  const inTab = itemsInTab(orderItems(items, order), topic);
  const grouped = topic === ALL && tabs.length > 0 ? groupByTab(inTab, tabs) : null;
  const headings = new Map<string, string>();
  for (const g of grouped ?? []) {
    const first = g.items[0];
    if (first) headings.set(first.messageId, `${g.tab.title} · ${g.items.length}`);
  }
  const base = grouped ? grouped.flatMap((g) => g.items) : inTab;
  return { matches: filterItems(base, q), headings };
};
