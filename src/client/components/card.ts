import type { WatchStatus } from '../../server/types.ts';

const STATUS_LABEL: Record<WatchStatus, string> = {
  want: 'quero ver',
  watching: 'assistindo',
  watched: 'assistido',
  dropped: 'abandonado',
};

const initials = (title: string): string =>
  title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

export interface CardOptions {
  title: string;
  posterUrl: string | null;
  meta?: string;
  status?: WatchStatus;
  isPublicDomain?: boolean;
  onClick: () => void;
}

export const renderCard = (opts: CardOptions): HTMLElement => {
  const card = document.createElement('div');
  card.className = 'card';
  card.addEventListener('click', opts.onClick);

  const poster = document.createElement('div');
  if (opts.posterUrl) {
    poster.className = 'poster';
    poster.style.backgroundImage = `url("${opts.posterUrl}")`;
  } else {
    poster.className = 'poster placeholder';
    poster.innerHTML = `<span class="initials">${initials(opts.title)}</span>`;
  }

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
