import { listRecentTelegramItems, type TelegramRecentItemDto } from '../api.ts';
import { icon } from '../icons.ts';
import { navigate } from '../router.ts';
import { formatDuration } from '../time-format.ts';
import { renderCard } from './card.ts';

const cardFor = (item: TelegramRecentItemDto): HTMLElement => {
  const duration = formatDuration(item.durationSeconds);
  return renderCard({
    title: item.caption?.trim() || item.channelTitle,
    posterUrl: item.thumbnailUrl,
    meta: [item.channelTitle, duration].filter(Boolean).join(' · '),
    onClick: () => navigate(`/telegram/${item.channelId}`),
  });
};

/** Faixa "novo nos canais": os vídeos mais recentes de todos os canais, para entrar direto no que chegou. */
export const renderTelegramFeed = (host: HTMLElement, opts: { limit?: number; hideWhenEmpty?: boolean } = {}): void => {
  host.innerHTML = `<div class="rail">${Array.from({ length: 5 }, () => '<div class="skeleton" style="width:168px;aspect-ratio:2/3;flex:0 0 168px"></div>').join('')}</div>`;
  listRecentTelegramItems(opts.limit ?? 12)
    .then(({ items }) => {
      if (items.length === 0) {
        if (opts.hideWhenEmpty) {
          host.closest(".section")?.setAttribute("hidden", "");
          return;
        }
        host.innerHTML = `<div class="empty-state">${icon('send')}<p>nenhum vídeo de canal ainda — <a href="#/telegram">adicione um canal</a> ou <a href="#/connections">conecte sua conta</a></p></div>`;
        return;
      }
      const rail = document.createElement('div');
      rail.className = 'rail';
      for (const item of items) rail.appendChild(cardFor(item));
      host.innerHTML = '';
      host.appendChild(rail);
    })
    .catch(() => {
      host.innerHTML = '<div class="empty-state">não foi possível carregar os vídeos dos canais</div>';
    });
};
