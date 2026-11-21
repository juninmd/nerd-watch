/** Altura mínima (px) do hero encolhido: pôster pequeno, título e ações ainda visíveis. */
export const HERO_MIN_PX = 132;

/** Quanto do hero já encolheu (0 = inteiro, 1 = só a faixa mínima). Pura, para teste. */
export const heroProgress = (scrolled: number, collapsible: number): number => {
  if (!Number.isFinite(scrolled) || collapsible <= 0) return scrolled > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, scrolled / collapsible));
};

/**
 * Hero grudento que encolhe ao rolar: fica `sticky` com `top` negativo, deixando só a faixa de baixo à vista.
 * O CSS lê `--p` (0..1) para escalar fundo, pôster e título. Os ouvintes saem sozinhos quando a tela troca.
 */
export const attachCollapsingHero = (hero: HTMLElement): void => {
  hero.classList.add('hero-premium');
  const ctrl = new AbortController();
  let frame = 0;
  const update = () => {
    frame = 0;
    if (!hero.isConnected) {
      ctrl.abort();
      return;
    }
    // A barra superior também é sticky: o hero gruda logo abaixo dela.
    const topbar = document.querySelector<HTMLElement>('.topbar')?.offsetHeight ?? 0;
    const collapsible = hero.offsetHeight - HERO_MIN_PX;
    hero.style.top = `${topbar - collapsible}px`;
    const p = heroProgress(topbar - hero.getBoundingClientRect().top, collapsible);
    hero.style.setProperty('--p', p.toFixed(3));
    hero.classList.toggle('is-collapsed', p >= 1);
  };
  const schedule = () => {
    if (!hero.isConnected) {
      ctrl.abort();
      return;
    }
    if (!frame) frame = requestAnimationFrame(update);
  };
  addEventListener('scroll', schedule, { passive: true, signal: ctrl.signal });
  addEventListener('resize', schedule, { passive: true, signal: ctrl.signal });
  update();
};
