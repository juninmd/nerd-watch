import { listRecentTelegramItems, telegramPlayUrl, type TelegramRecentItemDto } from '../api.ts';
import { icon } from '../icons.ts';
import { formatDuration } from '../time-format.ts';
import { renderCard } from './card.ts';
import { type DockItem, playInDock } from './player-dock.ts';

const titleOf = (item: TelegramRecentItemDto): string => item.caption?.split('\n').find((l) => l.trim())?.slice(0, 80) ?? item.channelTitle;

const toDockItem = (item: TelegramRecentItemDto): DockItem => ({
  key: `${item.channelId}:${item.messageId}`,
  src: telegramPlayUrl(item.channelId, item.messageId),
  title: titleOf(item),
  subtitle: item.channelTitle,
  poster: item.thumbnailUrl,
  href: `/telegram/${item.channelId}`,
});

/** Faixa "novo nos canais": toca direto no player global, com a faixa inteira como fila. */
export const renderTelegramFeed = (host: HTMLElement, opts: { limit?: number; hideWhenEmpty?: boolean } = {}): void => {
  host.innerHTML = `<div class="rail">${Array.from({ length: 5 }, () => '<div class="skeleton" style="width:168px;aspect-ratio:2/3;flex:0 0 168px"></div>').join('')}</div>`;
  listRecentTelegramItems(opts.limit ?? 12)
    .then(({ items }) => {
      if (items.length === 0) {
        if (opts.hideWhenEmpty) {
          host.closest('.section')?.setAttribute('hidden', '');
          return;
        }
        host.innerHTML = `<div class="empty-state">${icon('send')}<p>nenhum vídeo de canal ainda — <a href="#/telegram">adicione um canal</a> ou <a href="#/connections">conecte sua conta</a></p></div>`;
        return;
      }
      const queue = items.map(toDockItem);
      const rail = document.createElement('div');
      rail.className = 'rail';
      for (const [i, item] of items.entries()) {
        rail.appendChild(
          renderCard({
            title: titleOf(item),
            posterUrl: item.thumbnailUrl,
            meta: [item.channelTitle, formatDuration(item.durationSeconds)].filter(Boolean).join(' · '),
            onClick: () => playInDock(queue, i),
          }),
        );
      }
      host.innerHTML = '';
      host.appendChild(rail);
    })
    .catch(() => {
      host.innerHTML = '<div class="empty-state">não foi possível carregar os vídeos dos canais</div>';
    });
};
