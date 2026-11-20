import { getTitleStreams, openAddonStream, type TitleStreamsDto, type TitleStreamsQuery } from '../api/stremio.ts';
import type { CaptionContext } from '../player/player-captions-model.ts';
import { renderInlinePlayer } from '../player/inline-player.ts';
import { stopIfOnPage, stopIfOnPageIn } from '../player/player-dock.ts';
import { releaseTorrentPlayers, renderTorrentPanel } from '../player/torrent-player.ts';
import { embedFrameHtml } from '../player/watch-embed.ts';
import { currentRoute } from '../app/router.ts';
import { escapeHtml } from '../ui/card.ts';
import { streamCardHtml } from './stream-card.ts';
import { type AddonStreamGroup as Group, type AddonStreamItem as Stream, findAddonStream } from './stream-lookup.ts';

export interface StreamsView {
  title: string;
  posterUrl: string | null;
  route: string;
  captions: CaptionContext | null;
  /** Onde o vídeo/torrent aparece. Sem ele, o painel cria um slot no topo (caso do episódio). */
  playerHost?: HTMLElement | null;
}

export interface TitleStreamsView {
  title: string;
  posterUrl: string | null;
  /** Coluna principal do título: o vídeo não cabe no cartão lateral. */
  playerHost?: HTMLElement | null;
}

/** Um embed de YouTube por tela: o iframe não passa pelo player global, então o painel guarda o atual. */
let currentEmbed: HTMLElement | null = null;
const clearEmbed = (): void => {
  currentEmbed?.remove();
  currentEmbed = null;
};

const streamLi = (g: Group, s: Stream): string =>
  streamCardHtml(s, {
    buttonAttrs: `data-addon="${escapeHtml(g.addonId)}" data-index="${s.index}"`,
  });

const groupHtml = (g: Group): string => {
  const body = g.error
    ? `<p class="hint" role="alert">erro: ${escapeHtml(g.error)}</p>`
    : g.streams.length
      ? `<ul class="stream-list">${g.streams.map((s) => streamLi(g, s)).join('')}</ul>`
      : '<p class="hint">nenhum stream para este título.</p>';
  return `<div class="addon-stream-group"><h4>${escapeHtml(g.name)} <small>${escapeHtml(g.host)}</small></h4>${body}</div>`;
};

/**
 * Lista os streams de todos os addons e toca no mesmo player do app: URL/YouTube embutidos e
 * `infoHash` no motor P2P local (o servidor reconsulta o addon pela posição, nunca pelo cliente).
 */
export const mountStreams = (container: HTMLElement, dto: TitleStreamsDto, view: StreamsView): void => {
  // Uma remontagem (ex.: resposta antiga chegando depois de fechar/abrir o episódio) não pode deixar player/torrent órfão.
  releaseTorrentPlayers(container);
  stopIfOnPageIn(container);
  if (currentEmbed && container.contains(currentEmbed)) clearEmbed();
  const externalPlayer = view.playerHost ?? null;
  if (externalPlayer) externalPlayer.innerHTML = '';
  container.innerHTML = `${externalPlayer ? '' : '<div class="addon-stream-player"></div>'}${dto.addons.map(groupHtml).join('')}`;
  const playerHost = externalPlayer ?? container.querySelector<HTMLElement>('.addon-stream-player');
  if (!playerHost) return;

  const resetPlayer = () => {
    // Sem escopo de propósito: começar uma fonte fecha qualquer torrent da tela (um player por vez).
    clearEmbed();
    releaseTorrentPlayers();
    playerHost.innerHTML = '';
  };

  /** Leva o foco (e a rolagem) para onde o vídeo apareceu: o botão está na outra coluna ou em outra linha. */
  const reveal = () => {
    if (!playerHost.hasAttribute('tabindex')) playerHost.tabIndex = -1;
    if (!playerHost.hasAttribute('role')) playerHost.setAttribute('role', 'region');
    if (!playerHost.hasAttribute('aria-label')) playerHost.setAttribute('aria-label', 'Player do stream');
    playerHost.focus({ preventScroll: true });
    playerHost.scrollIntoView({ block: 'nearest' });
  };

  const playUrl = (g: Group, s: Stream) => {
    stopIfOnPage();
    resetPlayer();
    if (s.kind === 'youtube' && s.url) {
      playerHost.innerHTML = `<div class="player-frame">${embedFrameHtml(s.url, view.title)}</div>`;
      currentEmbed = playerHost.firstElementChild as HTMLElement | null;
      reveal();
      return;
    }
    if (!s.url) return;
    playerHost.appendChild(
      renderInlinePlayer({
        item: {
          key: `stremio:${g.addonId}:${g.contentId}:${s.index}`,
          src: s.url,
          title: view.title,
          subtitle: `Addon · ${g.name}`,
          poster: view.posterUrl,
          channelId: 'stremio',
          messageId: g.contentId,
          durationSeconds: null,
          route: view.route,
          captions: view.captions,
        },
        minimizable: true,
        onUnsupported: () => {
          stopIfOnPage();
          playerHost.textContent = 'O navegador não tocou este stream; tente outro da lista.';
        },
      }),
    );
    reveal();
  };

  const playTorrent = (g: Group, s: Stream) => {
    stopIfOnPage();
    resetPlayer();
    let panel: HTMLElement | null = null;
    panel = renderTorrentPanel({
      identifier: g.contentId,
      title: s.filename ?? view.title,
      posterUrl: view.posterUrl,
      open: (fileIndex) => openAddonStream(g.addonId, g.type, g.contentId, s.index, fileIndex),
      sourceLabel: `Addon · ${g.name}`,
      hint: 'O servidor conecta direto nos peers deste torrent e serve os pedaços ao player; nada fica semeando ao sair da tela.',
      player: { channelId: 'addon', messageId: g.contentId, route: view.route },
      autoStart: true,
      // Trocar de fonte em outro episódio libera este painel; sem isso sobraria um "parar" apontando para torrent fechado.
      onRelease: () => panel?.remove(),
    });
    playerHost.appendChild(panel);
    reveal();
  };

  // `onclick` (e não `addEventListener`) mantém um handler só quando o mesmo slot é remontado após fechar/abrir o episódio.
  container.onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-addon]');
    if (!button) return;
    const found = findAddonStream(dto, button.dataset.addon, Number(button.dataset.index));
    if (!found) return;
    if (found.stream.kind === 'torrent') playTorrent(found.group, found.stream);
    else playUrl(found.group, found.stream);
  };
};

/** Addons só de streams não têm catálogo: os streams entram aqui, a partir do IMDb do título do TMDB. Sem addon de stream, o card some. */
export const renderTitleStreams = (host: HTMLElement, opts: TitleStreamsQuery, view: TitleStreamsView): void => {
  const card = host.closest<HTMLElement>('.side-card');
  if (card) card.hidden = true;
  getTitleStreams(opts)
    .then((dto) => {
      if (!dto.addons.length) return;
      if (card) card.hidden = false;
      mountStreams(host, dto, {
        title: view.title,
        posterUrl: view.posterUrl,
        route: currentRoute().path,
        playerHost: view.playerHost ?? null,
        captions: {
          query: view.title,
          ...(opts.tmdbId ? { tmdbId: opts.tmdbId } : {}),
          mediaType: opts.mediaType,
          season: opts.season ?? null,
          episode: opts.episode ?? null,
        },
      });
    })
    .catch(() => {
      // Falha geral (ex.: TMDB fora): sem addons instalados não há o que avisar, então o card segue oculto.
    });
};
