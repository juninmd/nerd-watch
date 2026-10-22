import { listRecentTelegramItems, type TelegramRecentItemDto } from '../api.ts';
import { icon } from '../icons.ts';
import { navigate } from '../router.ts';
import { itemTitle, watchPath } from '../telegram-items.ts';
import { formatDuration } from '../time-format.ts';
import { renderCard } from './card.ts';
import { mountCarousel } from './carousel.ts';

/** Quantos vídeos o carrossel mostra: é o teto que o servidor aceita em `/api/telegram/recent`. */
export const FEED_LIMIT = 50;

const titleOf = (item: TelegramRecentItemDto): string => (item.caption?.trim() ? itemTitle(item) : item.channelTitle);

/** Carrossel "novo nos canais" com os vídeos mais recentes: cada cartão abre o vídeo na tela de reprodução do canal dele. */
export const renderTelegramFeed = (host: HTMLElement, opts: { limit?: number; hideWhenEmpty?: boolean } = {}): void => {
  host.innerHTML = `<div class="rail">${Array.from({ length: 5 }, () => '<div class="skeleton" style="width:168px;aspect-ratio:2/3;flex:0 0 168px"></div>').join('')}</div>`;
  listRecentTelegramItems(opts.limit ?? FEED_LIMIT)
    .then(({ items }) => {
      if (items.length === 0) {
        if (opts.hideWhenEmpty) {
          host.closest('.section')?.setAttribute('hidden', '');
          return;
        }
        host.innerHTML = `<div class="empty-state">${icon('send')}<p>nenhum vídeo de canal ainda — <a href="#/telegram">adicione um canal</a> ou <a href="#/connections">conecte sua conta</a></p></div>`;
        return;
      }
      const rail = document.createElement('div');
      rail.className = 'rail';
      for (const item of items) {
        rail.appendChild(
          renderCard({
            title: titleOf(item),
            posterUrl: item.thumbnailUrl,
            meta: [item.channelTitle, formatDuration(item.durationSeconds)].filter(Boolean).join(' · '),
            onClick: () => navigate(watchPath(item.channelId, item.messageId)),
          }),
        );
      }
      host.innerHTML = '';
      host.appendChild(mountCarousel(rail, { label: 'Novo nos canais: vídeos mais recentes' }));
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = `${items.length} vídeo${items.length === 1 ? '' : 's'} mais recente${items.length === 1 ? '' : 's'} dos seus canais`;
      host.appendChild(hint);
    })
    .catch(() => {
      host.innerHTML = '<div class="empty-state">não foi possível carregar os vídeos dos canais</div>';
    });
};
