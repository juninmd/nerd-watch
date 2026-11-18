import { escapeHtml } from '../ui/card.ts';
import { ALL, messageLink, type PinInfo, type TopicTab } from './channel-topics.ts';

/** Abas por subgrupo (tópico do fórum): "Todos" mostra tudo agrupado; cada aba mostra só aquele tópico. */
export const topicTabsHtml = (tabs: readonly TopicTab[], active: string, total: number): string => {
  if (tabs.length === 0) return '';
  const tab = (id: string, label: string, count: number, pinned = false) =>
    `<button class="chip${id === active ? ' active' : ''}" type="button" role="tab" aria-selected="${id === active}" data-topic="${escapeHtml(id)}">${pinned ? '📌 ' : ''}${escapeHtml(label)} <span class="tg-tab-count">${count}</span></button>`;
  return `<div class="tg-topics" role="tablist" aria-label="Subgrupos do canal">${tab(ALL, 'Todos', total)}${tabs.map((t) => tab(t.id, t.title, t.count, t.pinned)).join('')}</div>`;
};

const pinLabel = (text: string | null): string => {
  const first = text?.split('\n').find((l) => l.trim());
  return first ? first.trim() : 'mensagem fixada (sem texto)';
};

/**
 * Barra lateral de fixadas: tópicos fixados (abrem a aba) e mensagens fixadas (abrem no Telegram).
 * `<details>`: no desktop fica aberta e colada ao topo; no celular o CSS a leva para cima da lista e o usuário recolhe.
 */
export const pinsCardHtml = (handle: string, pins: readonly PinInfo[], tabs: readonly TopicTab[]): string => {
  const pinnedTopics = tabs.filter((t) => t.pinned);
  if (pins.length === 0 && pinnedTopics.length === 0) return '';
  const topics = pinnedTopics
    .map((t) => `<li><button class="tg-pin-link" type="button" data-topic="${escapeHtml(t.id)}">📌 ${escapeHtml(t.title)} <span class="tg-tab-count">${t.count}</span></button></li>`)
    .join('');
  const messages = pins
    .map(
      (p) =>
        `<li><a class="tg-pin-link" href="${escapeHtml(messageLink(handle, p.messageId))}" target="_blank" rel="noopener noreferrer">${escapeHtml(pinLabel(p.text))}${p.postedAt ? `<small>${new Date(p.postedAt).toLocaleDateString('pt-BR')}</small>` : ''}</a></li>`,
    )
    .join('');
  return `<details class="side-card tg-pins" open><summary><h3>Fixadas <span class="tg-tab-count">${pins.length + pinnedTopics.length}</span></h3></summary><ul class="tg-pin-list">${topics}${messages}</ul></details>`;
};

/** No celular a lista de fixadas começa recolhida: não empurra os vídeos para baixo. */
export const collapsePinsOnPhone = (host: HTMLElement): void => {
  const pins = host.querySelector('details.tg-pins') as HTMLDetailsElement | null;
  if (pins && typeof matchMedia === 'function' && matchMedia('(max-width: 980px)').matches) pins.open = false;
};
