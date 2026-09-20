import { searchArchive, type ArchiveMovieDto } from '../api.ts';
import { renderCard } from '../components/card.ts';
import { navigate } from '../router.ts';
import { titlePath } from '../title-link.ts';

export const renderPublicDomain = (host: HTMLElement): void => {
  host.innerHTML = `
    <h1 class="view-title">🎞️ Domínio público</h1>
    <p class="view-subtitle">
      Filmes clássicos com direitos autorais expirados, servidos direto pelo Internet Archive — assista dentro do
      app e baixe pelo torrent oficial gerado pela própria Archive.org. 100% legal, sem chave de API.
    </p>
    <div class="chip-row" style="margin-bottom:20px">
      <input type="search" id="pd-search" placeholder="Buscar no acervo (ex: Chaplin, terror, faroeste)..."
        style="flex:1;min-width:240px;padding:9px 14px;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text)" />
    </div>
    <div id="pd-grid"><div class="grid">${Array.from({ length: 12 }, () => '<div class="skeleton" style="aspect-ratio:2/3"></div>').join('')}</div></div>
  `;

  const grid = host.querySelector('#pd-grid') as HTMLElement;
  const input = host.querySelector('#pd-search') as HTMLInputElement;

  const renderResults = (items: ArchiveMovieDto[]) => {
    if (items.length === 0) {
      grid.innerHTML = `<div class="empty-state"><div class="big">🕵️</div>nada encontrado nesse acervo</div>`;
      return;
    }
    const g = document.createElement('div');
    g.className = 'grid';
    for (const m of items) {
      g.appendChild(
        renderCard({
          title: m.title,
          posterUrl: m.thumbnailUrl,
          meta: m.year ?? undefined,
          isPublicDomain: true,
          onClick: () => navigate(titlePath('archive', '_', m.identifier)),
        }),
      );
    }
    grid.innerHTML = '';
    grid.appendChild(g);
  };

  const load = (q: string) => {
    grid.innerHTML = `<div class="grid">${Array.from({ length: 12 }, () => '<div class="skeleton" style="aspect-ratio:2/3"></div>').join('')}</div>`;
    searchArchive(q)
      .then((data) => renderResults(data.results))
      .catch(() => {
        grid.innerHTML = `<div class="empty-state"><div class="big">⚠️</div>Internet Archive indisponível agora</div>`;
      });
  };

  let debounce: ReturnType<typeof setTimeout>;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => load(input.value.trim()), 350);
  });

  load('');
};
