import { edges, scrollTarget, siblingIndex } from '../carousel.ts';
import { icon } from '../icons.ts';

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Envolve uma faixa (`.rail`) num carrossel: setas que andam quase uma tela, setas do teclado entre os cartões e
 * regiões nomeadas para leitor de tela. As setas somem quando todo o conteúdo cabe e desabilitam nas pontas.
 */
export const mountCarousel = (rail: HTMLElement, opts: { label: string }): HTMLElement => {
  const root = document.createElement('div');
  root.className = 'carousel';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-roledescription', 'carrossel');
  root.setAttribute('aria-label', opts.label);

  const arrow = (direction: -1 | 1): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `carousel-btn ${direction < 0 ? 'carousel-prev' : 'carousel-next'}`;
    btn.setAttribute('aria-label', direction < 0 ? 'Ver os anteriores' : 'Ver os próximos');
    btn.innerHTML = icon(direction < 0 ? 'back' : 'forward');
    btn.addEventListener('click', () => rail.scrollTo({ left: scrollTarget(rail, direction), behavior: reducedMotion() ? 'auto' : 'smooth' }));
    return btn;
  };
  const prev = arrow(-1);
  const next = arrow(1);

  const sync = () => {
    const { atStart, atEnd } = edges(rail);
    prev.disabled = atStart;
    next.disabled = atEnd;
    root.classList.toggle('is-static', atStart && atEnd);
  };
  rail.addEventListener('scroll', sync, { passive: true });
  new ResizeObserver(sync).observe(rail);

  // Tab já leva o foco cartão a cartão (e o navegador rola até ele); as setas fazem o mesmo sem sair da faixa.
  rail.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const cards = [...rail.children] as HTMLElement[];
    const at = cards.indexOf((e.target as HTMLElement).closest('.card') as HTMLElement);
    const to = siblingIndex(at, cards.length, e.key === 'ArrowRight' ? 1 : -1);
    if (to < 0) return;
    e.preventDefault();
    const card = cards[to] as HTMLElement;
    card.focus();
    card.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  });

  root.append(prev, rail, next);
  sync();
  return root;
};
