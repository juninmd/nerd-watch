import type { LibraryItemDto } from '../api/index.ts';
import { escapeHtml, titleHue } from '../ui/card.ts';

/** Texto do destaque "Continuar": série com episódio atual mostra "T2 · Ep 7"; sem episódio, o tipo. Sem DOM. */
export const heroMeta = (item: LibraryItemDto): string => {
  const { currentSeason: season, currentEpisode: episode } = item;
  if (season && episode) return `Continuar · T${season} · Ep ${episode}`;
  return item.title.mediaType === 'tv' ? 'Continuar · Série' : 'Continuar · Filme';
};

/** Primeiro título "assistindo" vira o destaque da tela inicial (o que a pessoa largou por último). */
export const pickHero = (watching: LibraryItemDto[]): LibraryItemDto | null => watching[0] ?? null;

/** HTML do destaque. Dado externo sempre por `escapeHtml`; a imagem entra como `<img>` (nunca em `style`). */
export const heroHtml = (item: LibraryItemDto): string => {
  const hue = titleHue(item.title.title);
  const poster = item.title.posterUrl ? `<img class="hero-poster" src="${escapeHtml(item.title.posterUrl)}" alt="" width="120" height="180" />` : '';
  return `
    <article class="continue-hero" style="--hue:${hue}">
      <div class="continue-body">
        <span class="continue-meta">${escapeHtml(heroMeta(item))}</span>
        <h2 class="continue-title">${escapeHtml(item.title.title)}</h2>
        <div class="continue-actions">
          <button class="btn btn-primary" type="button" data-hero="open">Continuar</button>
        </div>
      </div>
      ${poster}
    </article>`;
};
