import { type LibraryItemDto, listLibrary } from '../api.ts';
import { escapeHtml } from './card.ts';
import { filterPickCandidates, type PickFilters, type PickType, pickRandom } from '../pick-random.ts';
import { navigate } from '../router.ts';
import { libraryItemPath } from '../title-link.ts';

const TYPE_OPTIONS: Array<{ value: PickType; label: string }> = [
  { value: 'all', label: 'filmes e séries' },
  { value: 'movie', label: 'só filmes' },
  { value: 'tv', label: 'só séries' },
];

const RATING_OPTIONS = [6, 7, 8, 9];

let dialog: HTMLDialogElement | null = null;

const metaLine = (item: LibraryItemDto): string => {
  const parts = [
    item.title.releaseDate?.slice(0, 4),
    item.title.mediaType === 'tv' ? 'série' : 'filme',
    item.title.voteAverage !== null ? `nota ${item.title.voteAverage.toFixed(1)}` : null,
  ];
  return parts.filter(Boolean).join(' · ');
};

/**
 * "O que assistir hoje": sorteia um título da lista "quero ver" com filtros de tipo e nota mínima.
 * O resultado vai para uma região aria-live, e "Outro" nunca repete o sorteio anterior (com 2+ candidatos).
 */
export const openPickDialog = (): void => {
  if (dialog?.open) return;
  const d = document.createElement('dialog');
  d.className = 'pick-dialog';
  d.setAttribute('closedby', 'any');
  d.setAttribute('aria-labelledby', 'pick-title');
  d.innerHTML = `
    <div class="pick-head">
      <h2 id="pick-title" tabindex="-1">O que assistir hoje</h2>
      <button class="btn btn-ghost btn-sm" type="button" id="pick-close" aria-label="Fechar">✕</button>
    </div>
    <p class="pick-sub">Sorteio entre os títulos da sua lista "quero ver".</p>
    <div class="pick-filters">
      <label>Tipo <select class="select input-pill" id="pick-type">${TYPE_OPTIONS.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')}</select></label>
      <label>Nota mínima <select class="select input-pill" id="pick-rating"><option value="">qualquer</option>${RATING_OPTIONS.map((n) => `<option value="${n}">${n}+</option>`).join('')}</select></label>
    </div>
    <div class="pick-result" id="pick-result" aria-live="polite"><div class="empty-state">carregando sua lista…</div></div>
    <div class="pick-actions">
      <button class="btn" type="button" id="pick-again" disabled>Outro</button>
      <button class="btn btn-primary" type="button" id="pick-open" disabled>Abrir</button>
    </div>`;
  document.body.appendChild(d);
  dialog = d;
  d.addEventListener('close', () => {
    d.remove();
    if (dialog === d) dialog = null;
  });
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
  d.showModal();

  const resultEl = d.querySelector('#pick-result') as HTMLElement;
  const againBtn = d.querySelector('#pick-again') as HTMLButtonElement;
  const openBtn = d.querySelector('#pick-open') as HTMLButtonElement;
  const typeSel = d.querySelector('#pick-type') as HTMLSelectElement;
  const ratingSel = d.querySelector('#pick-rating') as HTMLSelectElement;

  let items: LibraryItemDto[] = [];
  let current: LibraryItemDto | null = null;

  const filters = (): PickFilters => ({
    type: typeSel.value as PickType,
    minRating: ratingSel.value ? Number(ratingSel.value) : null,
  });

  const setActions = (enabled: boolean) => {
    againBtn.disabled = !enabled;
    openBtn.disabled = !enabled;
  };

  const showEmpty = (html: string) => {
    current = null;
    setActions(false);
    resultEl.innerHTML = `<div class="empty-state">${html}</div>`;
  };

  /** `pick` sorteia de novo com os filtros atuais; o anterior sai do sorteio quando há outros candidatos. */
  const pick = () => {
    if (items.length === 0) {
      showEmpty('Sua lista "quero ver" está vazia. <br><button class="btn btn-sm" type="button" id="pick-search">buscar títulos</button>');
      d.querySelector('#pick-search')?.addEventListener('click', () => {
        d.close();
        navigate('/search');
      });
      return;
    }
    const candidates = filterPickCandidates(items, filters());
    if (candidates.length === 0) {
      showEmpty('Nenhum título da sua lista passa nesses filtros. <br><button class="btn btn-sm" type="button" id="pick-reset">limpar filtros</button>');
      d.querySelector('#pick-reset')?.addEventListener('click', () => {
        typeSel.value = 'all';
        ratingSel.value = '';
        pick();
      });
      return;
    }
    current = pickRandom(candidates, { avoidId: current?.titleId ?? null });
    if (!current) return;
    const item = current;
    setActions(true);
    resultEl.innerHTML = `
      <div class="pick-card">
        <div class="thumb"${item.title.posterUrl ? ` style="background-image:url('${escapeHtml(item.title.posterUrl)}')"` : ''}></div>
        <div><span class="pick-name">${escapeHtml(item.title.title)}</span><span class="pick-meta">${escapeHtml(metaLine(item))}</span></div>
      </div>`;
  };

  typeSel.addEventListener('change', pick);
  ratingSel.addEventListener('change', pick);
  againBtn.addEventListener('click', () => pick());
  openBtn.addEventListener('click', () => {
    if (!current) return;
    const target = libraryItemPath(current);
    d.close();
    navigate(target);
  });
  (d.querySelector('#pick-close') as HTMLButtonElement).addEventListener('click', () => d.close());

  (d.querySelector('#pick-title') as HTMLElement).focus();

  listLibrary('want')
    .then((data) => {
      if (!d.isConnected) return;
      items = data.items;
      pick();
    })
    .catch(() => {
      if (!d.isConnected) return;
      showEmpty('não foi possível carregar sua lista agora');
    });
};
