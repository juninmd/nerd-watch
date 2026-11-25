import { type RefObject, useEffect } from 'react';
import { heroProgress, HERO_MIN_PX } from './collapsing-hero.ts';

/**
 * Hero grudento que encolhe ao rolar: fica `sticky` com `top` negativo, deixando só a faixa de baixo à vista.
 * O CSS lê `--p` (0..1) para escalar fundo, pôster e título.
 */
export const useCollapsingHero = (ref: RefObject<HTMLElement | null>): void => {
  useEffect(() => {
    const hero = ref.current;
    if (!hero) return;
    hero.classList.add('hero-premium');
    let frame = 0;
    const update = () => {
      frame = 0;
      // A barra superior também é sticky: o hero gruda logo abaixo dela.
      const topbar = document.querySelector<HTMLElement>('.topbar')?.offsetHeight ?? 0;
      const collapsible = hero.offsetHeight - HERO_MIN_PX;
      hero.style.top = `${topbar - collapsible}px`;
      const p = heroProgress(topbar - hero.getBoundingClientRect().top, collapsible);
      hero.style.setProperty('--p', p.toFixed(3));
      hero.classList.toggle('is-collapsed', p >= 1);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const ctrl = new AbortController();
    addEventListener('scroll', schedule, { passive: true, signal: ctrl.signal });
    addEventListener('resize', schedule, { passive: true, signal: ctrl.signal });
    update();
    return () => {
      ctrl.abort();
      cancelAnimationFrame(frame);
    };
  }, [ref]);
};
