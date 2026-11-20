import { getTitleStreams, type TitleStreamsQuery } from '../api/stremio.ts';
import { currentRoute } from '../app/router.ts';
import { getVideo, stopIfOnPageIn } from '../player/player-dock.ts';
import { releaseTorrentPlayers } from '../player/torrent-player.ts';
import { escapeHtml } from '../ui/card.ts';
import { mountStreams } from './title-streams-panel.ts';

/** `null` = ainda não dá para consultar (ex.: IMDb da TVmaze não chegou); o texto vira aviso no painel. */
export type StreamsQueryResolver = () => TitleStreamsQuery | { unavailable: string };

const HINT = 'Instale um addon de streams em Addons para ver links aqui.';

/**
 * Título do episódio vira um botão que abre/fecha os streams dos addons Stremio para aquele episódio.
 * A consulta só roda no primeiro clique (uma temporada tem dezenas de episódios) e fica em cache na linha.
 */
export const wireEpisodeStreams = (row: HTMLElement, resolve: StreamsQueryResolver): void => {
  const btn = row.querySelector<HTMLButtonElement>('.ep-title');
  const slot = row.querySelector<HTMLElement>('.ep-streams');
  if (!btn || !slot) return;
  let loaded = false;
  let seq = 0;
  btn.addEventListener('click', () => {
    const open = slot.hidden;
    slot.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    // Fechar a linha esconderia os controles com o vídeo ainda tocando (e o torrent aberto): encerra só o que é desta linha.
    const video = getVideo();
    const ownsPlayer = Boolean(slot.querySelector('.torrent-panel, .inline-player, iframe')) || Boolean(video && slot.contains(video));
    if (!open && ownsPlayer) {
      stopIfOnPageIn(slot);
      releaseTorrentPlayers(slot);
      slot.innerHTML = '';
      loaded = false;
    }
    if (!open || loaded) return;
    const q = resolve();
    if ('unavailable' in q) {
      slot.innerHTML = `<p class="hint">${escapeHtml(q.unavailable)}</p>`;
      return;
    }
    const mine = ++seq;
    slot.innerHTML = '<div class="skeleton" style="height:44px"></div>';
    slot.setAttribute('aria-busy', 'true');
    getTitleStreams(q)
      .then((dto) => {
        // Fechar/abrir antes da resposta dispara outra consulta: a antiga não pode montar por cima da nova.
        if (mine !== seq) return;
        loaded = true;
        if (!dto.addons.length) {
          slot.innerHTML = `<p class="hint">${HINT}</p>`;
          return;
        }
        mountStreams(slot, dto, {
          title: btn.textContent?.trim() || 'Episódio',
          posterUrl: null,
          route: currentRoute().path,
          captions: {
            query: btn.textContent?.trim() ?? undefined,
            ...(q.tmdbId ? { tmdbId: q.tmdbId } : {}),
            mediaType: q.mediaType,
            season: q.season ?? null,
            episode: q.episode ?? null,
          },
        });
      })
      .catch(() => {
        if (mine !== seq) return;
        slot.innerHTML = '<p class="hint" role="alert">não foi possível consultar os addons agora; feche e abra para tentar de novo.</p>';
      })
      .finally(() => {
        if (mine === seq) slot.removeAttribute('aria-busy');
      });
  });
};
