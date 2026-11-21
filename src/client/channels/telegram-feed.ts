import { listRecentTelegramItems, type TelegramRecentItemDto } from '../api/index.ts';
import { icon } from '../ui/icons.ts';
import { navigate } from '../app/router.ts';
import { showToast } from '../app/state.ts';
import { itemTitle, watchPath } from './telegram-items.ts';
import { formatDuration } from '../ui/time-format.ts';
import { renderCard } from '../ui/card.ts';
import { mountCarousel } from '../ui/carousel.ts';
import { feedSyncGate, syncAllChannels } from './feed-sync.ts';

/** Quantos vídeos o carrossel mostra: é o teto que o servidor aceita em `/api/telegram/recent`. */
export const FEED_LIMIT = 50;

const titleOf = (item: TelegramRecentItemDto): string => (item.caption?.trim() ? itemTitle(item) : item.channelTitle);

type Opts = { limit?: number; hideWhenEmpty?: boolean };

/** Carrossel "novo nos canais" com os vídeos mais recentes: cada cartão abre o vídeo na tela de reprodução do canal dele. */
export const renderTelegramFeed = (host: HTMLElement, opts: Opts = {}): void => {
  const limit = opts.limit ?? FEED_LIMIT;
  const section = host.closest<HTMLElement>('.section');
  const button = mountRefreshButton(section);

  const paint = (items: TelegramRecentItemDto[]): void => {
    if (items.length === 0) {
      if (opts.hideWhenEmpty) {
        section?.setAttribute('hidden', '');
        return;
      }
      section?.removeAttribute('hidden');
      host.innerHTML = `<div class="empty-state">${icon('send')}<p>nenhum vídeo de canal ainda — <a href="#/telegram">adicione um canal</a> ou <a href="#/connections">conecte sua conta</a></p></div>`;
      return;
    }
    section?.removeAttribute('hidden');
    // Guarda a posição da faixa: atualizar em segundo plano não pode puxar a pessoa de volta ao começo.
    const keepScroll = host.querySelector<HTMLElement>('.rail')?.scrollLeft ?? 0;
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
    const carousel = mountCarousel(rail, { label: 'Novo nos canais: vídeos mais recentes' });
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = `${items.length} vídeo${items.length === 1 ? '' : 's'} mais recente${items.length === 1 ? '' : 's'} dos seus canais`;
    host.replaceChildren(carousel, hint);
    rail.scrollLeft = keepScroll;
  };

  /** Só relê o que já está no banco local: barato, e é o que mostra o resultado de uma rodada de sincronização. */
  const load = (): Promise<void> =>
    listRecentTelegramItems(limit)
      .then(({ items }) => {
        if (host.isConnected) paint(items);
      })
      .catch(() => {
        // Em atualização silenciosa, manter a lista antiga é melhor que trocá-la por um erro.
        if (host.isConnected && !host.querySelector('.rail')) host.innerHTML = '<div class="empty-state">não foi possível carregar os vídeos dos canais</div>';
      });

  /** Lê os canais no Telegram e repinta. `manual` ignora o intervalo mínimo e avisa o resultado. */
  const refresh = async (manual: boolean): Promise<void> => {
    if (!host.isConnected || !feedSyncGate.tryStart(manual)) return;
    button?.setBusy(true);
    try {
      const { failed } = await syncAllChannels();
      if (manual && failed > 0) showToast(`${failed} canal(is) não puderam ser atualizados agora`);
      else if (manual) showToast('vídeos atualizados');
    } catch {
      if (manual) showToast('não foi possível atualizar agora');
    } finally {
      feedSyncGate.finish();
      button?.setBusy(false);
    }
    if (host.isConnected) await load();
  };

  host.innerHTML = `<div class="rail">${Array.from({ length: 5 }, () => '<div class="skeleton" style="width:168px;aspect-ratio:2/3;flex:0 0 168px"></div>').join('')}</div>`;
  button?.onClick(() => void refresh(true));
  void load().then(() => refresh(false));

  // Voltar à aba/janela: o gate garante o intervalo mínimo. Sai da escuta quando a tela é trocada.
  const onReturn = () => {
    if (!host.isConnected) {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onReturn);
      return;
    }
    void refresh(false);
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') onReturn();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onReturn);
};

/** Botão de atualizar no cabeçalho da seção, ao lado do link "ver canais" quando existir. */
const mountRefreshButton = (section: HTMLElement | null): { setBusy(busy: boolean): void; onClick(fn: () => void): void } | null => {
  const head = section?.querySelector<HTMLElement>('.section-head');
  if (!head) return null;
  head.querySelector('.section-head-actions')?.remove();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-ghost btn-sm refresh-btn';
  btn.setAttribute('aria-label', 'Atualizar vídeos dos canais');
  btn.innerHTML = `${icon('refresh', 'sm')}<span>atualizar</span>`;
  const actions = document.createElement('span');
  actions.className = 'section-head-actions';
  actions.appendChild(btn);
  const link = head.querySelector('a');
  if (link) actions.appendChild(link);
  head.appendChild(actions);
  return {
    setBusy(busy) {
      btn.disabled = busy;
      btn.classList.toggle('is-loading', busy);
      btn.setAttribute('aria-busy', String(busy));
    },
    onClick: (fn) => btn.addEventListener('click', fn),
  };
};
