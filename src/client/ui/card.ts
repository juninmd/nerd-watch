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

/**
 * Matiz (0 a 359) derivado do título: o mesmo título sempre cai na mesma cor, e uma grade sem pôsteres deixa de
 * ser uma parede de cartões iguais. Hash simples (djb2), sem aleatoriedade.
 */
export const titleHue = (title: string): number => {
  let hash = 5381;
  for (let i = 0; i < title.length; i++) hash = ((hash << 5) + hash + title.charCodeAt(i)) >>> 0;
  return hash % 360;
};

/** Placeholder com iniciais: o mesmo visual de pôster sem imagem, usado quando a imagem não carrega. */
export const showPosterFallback = (poster: HTMLElement, title: string): void => {
  poster.style.backgroundImage = '';
  poster.classList.add('placeholder');
  poster.style.setProperty('--ph', String(titleHue(title)));
  if (poster.querySelector('.initials')) return;
  poster.insertAdjacentHTML('afterbegin', `<span class="initials">${escapeHtml(initials(title))}</span>`);
};

/** Valor de `background-image` seguro para URL com aspas ou barra invertida (vem de catálogos de terceiros). */
export const posterCssUrl = (url: string): string => `url("${url.replace(/["\\]/g, '\\$&')}")`;

/**
 * A TMDB entrega a mesma imagem em várias larguras. Com `srcset`, uma tela de alta densidade recebe a versão
 * maior (o `w342` fixo ficava borrado em telas 2x) e uma tela comum não baixa mais do que precisa.
 * Outras origens (Archive, canais) têm um tamanho só: devolve `null`.
 */
export const posterSrcset = (url: string): string | null => {
  const m = url.match(/^(https:\/\/image\.tmdb\.org\/t\/p\/)w\d+(\/[^?#\s]+)$/);
  return m ? [342, 500, 780].map((w) => `${m[1]}w${w}${m[2]} ${w}w`).join(', ') : null;
};

/** Largura do card na grade e nos trilhos: o navegador escolhe a imagem do `srcset` por ela e pela densidade da tela. */
const POSTER_SIZES = '(max-width: 720px) 45vw, 220px';

/**
 * Põe o pôster como `<img>` preguiçosa: só baixa perto da área visível e decodifica fora da thread principal.
 * Se a imagem falha (rede, 404 do Archive), troca pelo placeholder em vez de um bloco preto.
 */
export const paintPoster = (poster: HTMLElement, url: string, title: string): void => {
  const img = new Image();
  img.className = 'poster-img';
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  const srcset = posterSrcset(url);
  if (srcset) {
    img.srcset = srcset;
    img.sizes = POSTER_SIZES;
  }
  img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
  img.addEventListener(
    'error',
    () => {
      img.remove();
      showPosterFallback(poster, title);
    },
    { once: true },
  );
  img.src = url;
  poster.prepend(img);
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
