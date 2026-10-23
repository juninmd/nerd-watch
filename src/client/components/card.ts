import type { WatchStatus } from '../../server/types.ts';

const STATUS_LABEL: Record<WatchStatus, string> = {
  want: 'quero ver',
  watching: 'assistindo',
  watched: 'assistido',
  dropped: 'abandonado',
};

export const initials = (title: string): string =>
  title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

/** Placeholder com iniciais: o mesmo visual de pôster sem imagem, usado quando a imagem não carrega. */
export const showPosterFallback = (poster: HTMLElement, title: string): void => {
  poster.style.backgroundImage = '';
  poster.classList.add('placeholder');
  if (poster.querySelector('.initials')) return;
  poster.insertAdjacentHTML('afterbegin', `<span class="initials">${escapeHtml(initials(title))}</span>`);
};

/** Valor de `background-image` seguro para URL com aspas ou barra invertida (vem de catálogos de terceiros). */
export const posterCssUrl = (url: string): string => `url("${url.replace(/["\\]/g, '\\$&')}")`;

/** Pinta o pôster por CSS. Se a imagem falha (rede, 404 do Archive), troca pelo placeholder em vez de um bloco preto. */
export const paintPoster = (poster: HTMLElement, url: string, title: string): void => {
  poster.style.backgroundImage = posterCssUrl(url);
  const probe = new Image();
  probe.addEventListener('error', () => showPosterFallback(poster, title));
  probe.src = url;
};

export interface CardOptions {
  title: string;
  posterUrl: string | null;
  meta?: string;
  status?: WatchStatus;
  isPublicDomain?: boolean;
  /** Modo seleção: o clique alterna a marca em vez de abrir o item. */
  selection?: { selected: boolean; onToggle: () => void };
  onClick: () => void;
}

export const renderCard = (opts: CardOptions): HTMLElement => {
  const card = document.createElement('div');
  card.className = 'card';
  card.tabIndex = 0;
  card.setAttribute('role', opts.selection ? 'checkbox' : 'link');
  if (opts.selection) {
    card.setAttribute('aria-checked', String(opts.selection.selected));
    card.classList.toggle('is-selected', opts.selection.selected);
  }
  card.setAttribute('aria-label', opts.meta ? `${opts.title} — ${opts.meta}` : opts.title);
  const activate = opts.selection ? opts.selection.onToggle : opts.onClick;
  card.addEventListener('click', activate);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || (e.key === ' ' && opts.selection)) {
      e.preventDefault();
      activate();
    }
  });

  const poster = document.createElement('div');
  poster.className = 'poster';
  if (opts.posterUrl) paintPoster(poster, opts.posterUrl, opts.title);
  else showPosterFallback(poster, opts.title);

  if (opts.status) {
    const badge = document.createElement('span');
    badge.className = `badge badge-${opts.status} badge-corner`;
    badge.textContent = STATUS_LABEL[opts.status];
    poster.appendChild(badge);
  } else if (opts.isPublicDomain) {
    const badge = document.createElement('span');
    badge.className = 'badge badge-archive badge-corner';
    badge.textContent = 'domínio público';
    poster.appendChild(badge);
  }

  if (opts.selection) poster.insertAdjacentHTML('beforeend', '<span class="select-mark" aria-hidden="true"></span>');

  card.appendChild(poster);

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML = `<div class="title">${escapeHtml(opts.title)}</div>${
    opts.meta ? `<div class="sub">${escapeHtml(opts.meta)}</div>` : ''
  }`;
  card.appendChild(meta);

  return card;
};

/** `String(s)` porque dados de catálogos de terceiros (TMDB/Archive) às vezes trocam tipo de campo sem aviso. */
export const escapeHtml = (s: string): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
