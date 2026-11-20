import { getTitleStreams, type TitleStreamsQuery } from '../api/stremio.ts';
import { escapeHtml } from '../ui/card.ts';
import { streamsHtml } from './title-streams-panel.ts';

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
  btn.addEventListener('click', () => {
    const open = slot.hidden;
    slot.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (!open || loaded) return;
    const q = resolve();
    if ('unavailable' in q) {
      slot.innerHTML = `<p class="hint">${escapeHtml(q.unavailable)}</p>`;
      return;
    }
    slot.innerHTML = '<div class="skeleton" style="height:44px"></div>';
    slot.setAttribute('aria-busy', 'true');
    getTitleStreams(q)
      .then((d) => {
        loaded = true;
        slot.innerHTML = d.addons.length ? streamsHtml(d) : `<p class="hint">${HINT}</p>`;
      })
      .catch(() => {
        slot.innerHTML = '<p class="hint" role="alert">não foi possível consultar os addons agora; feche e abra para tentar de novo.</p>';
      })
      .finally(() => slot.removeAttribute('aria-busy'));
  });
};
