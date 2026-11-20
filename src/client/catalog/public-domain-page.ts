import { type ArchiveCollectionDto, type ArchiveMovieDto, getArchiveCollections, searchArchive, searchCommons } from '../api/index.ts';
import { icon } from '../ui/icons.ts';
import { escapeHtml, renderCard } from '../ui/card.ts';
import { navigate } from '../app/router.ts';
import { titlePath } from '../ui/title-link.ts';

/** Fonte extra além das coleções da Archive: vídeos livres da Wikimedia Commons. */
const COMMONS = 'commons';
const FALLBACK_COLLECTIONS: ArchiveCollectionDto[] = [{ id: 'feature_films', label: 'Longas clássicos' }];
const SKELETON = `<div class="grid">${Array.from({ length: 12 }, () => '<div class="skeleton" style="aspect-ratio:2/3"></div>').join('')}</div>`;

export const renderPublicDomain = (host: HTMLElement): void => {
  host.innerHTML = `
    <h1 class="view-title">Domínio público</h1>
    <p class="view-subtitle">
      Filmes e vídeos de domínio público ou licença livre, de fontes que publicam a licença de cada item: coleções do
      Internet Archive (longas clássicos, cinema mudo, film noir, ficção científica e terror, animação, TV clássica, Prelinger, NASA) e a Wikimedia Commons (inclui os filmes abertos da
      Blender Foundation). Sem chave de API. Confira sempre a licença mostrada em cada item.
    </p>
    <div class="chip-row" id="pd-sources" role="group" aria-label="fonte do acervo"></div>
    <div class="chip-row" style="margin-bottom:20px">
      <input type="search" id="pd-search" placeholder="Buscar no acervo (ex: Chaplin, terror, faroeste)..."
        class="input input-pill grow" autocomplete="off" aria-label="buscar no acervo" />
    </div>
    <div id="pd-grid">${SKELETON}</div>
  `;

  const grid = host.querySelector('#pd-grid') as HTMLElement;
  const input = host.querySelector('#pd-search') as HTMLInputElement;
  const sourcesEl = host.querySelector('#pd-sources') as HTMLElement;
  let source = 'feature_films';
  let seq = 0;

  const show = (cards: HTMLElement[]) => {
    if (cards.length === 0) {
      grid.innerHTML = `<div class="empty-state"><div class="big">🕵️</div>nada encontrado nesse acervo</div>`;
      return;
    }
    const g = document.createElement('div');
    g.className = 'grid';
    for (const c of cards) g.appendChild(c);
    grid.innerHTML = '';
    grid.appendChild(g);
  };

  const archiveCards = (items: ArchiveMovieDto[]) =>
    items.map((m) => renderCard({ title: m.title, posterUrl: m.thumbnailUrl, meta: m.year ?? undefined, isPublicDomain: true, onClick: () => navigate(titlePath('archive', '_', m.identifier)) }));

  const load = (q: string) => {
    const mine = ++seq;
    grid.innerHTML = SKELETON;
    const request =
      source === COMMONS
        ? searchCommons(q).then((items) =>
            items.map((v) => renderCard({ title: v.name, posterUrl: v.thumbnailUrl, meta: v.license, isPublicDomain: true, onClick: () => navigate(`/commons/${encodeURIComponent(v.title)}`) })),
          )
        : searchArchive(q, source).then((data) => archiveCards(data.results));
    request
      .then((cards) => {
        if (mine === seq) show(cards);
      })
      .catch(() => {
        if (mine !== seq) return;
        grid.innerHTML = `<div class="empty-state"><div class="big">${icon('alert')}</div>${source === COMMONS ? 'Wikimedia Commons' : 'Internet Archive'} indisponível agora</div>`;
      });
  };

  const paintSources = (collections: ArchiveCollectionDto[]) => {
    const all = [...collections.map((c) => ({ id: c.id, label: `Archive: ${c.label}` })), { id: COMMONS, label: 'Wikimedia Commons' }];
    sourcesEl.innerHTML = all.map((s) => `<button type="button" class="chip${s.id === source ? ' active' : ''}" data-source="${escapeHtml(s.id)}" aria-pressed="${s.id === source}">${escapeHtml(s.label)}</button>`).join('');
  };

  sourcesEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-source]');
    if (!btn?.dataset.source || btn.dataset.source === source) return;
    source = btn.dataset.source;
    for (const b of sourcesEl.querySelectorAll<HTMLElement>('[data-source]')) {
      const on = b.dataset.source === source;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    load(input.value.trim());
  });

  paintSources(FALLBACK_COLLECTIONS);
  getArchiveCollections()
    .then(paintSources)
    .catch(() => undefined);

  let debounce: ReturnType<typeof setTimeout>;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => load(input.value.trim()), 350);
  });

  load('');
};
