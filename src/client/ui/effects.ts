/** Efeitos visuais leves. Tudo respeita `prefers-reduced-motion` e só liga com mouse (hover) quando faz sentido. */
const calm = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Número que sobe de 0 até `to`. Com movimento reduzido mostra o valor final direto. */
export const countUp = (el: HTMLElement, to: number, ms = 800): void => {
  if (calm() || to <= 0) {
    el.textContent = String(to);
    return;
  }
  const t0 = performance.now();
  const step = (now: number): void => {
    const p = Math.min(1, (now - t0) / ms);
    el.textContent = String(Math.round(to * (1 - (1 - p) ** 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};

const PARTICLE_COLORS = ['#ff3d6e', '#7c5cff', '#34d399', '#fbbf24', '#60a5fa'];

/** Confete em CSS a partir de um elemento (ex.: ao marcar um título como assistido). */
export const burst = (from: HTMLElement, count = 18): void => {
  if (calm()) return;
  const r = from.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'burst';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.left = `${r.left + r.width / 2}px`;
  layer.style.top = `${r.top + r.height / 2}px`;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 46 + Math.random() * 56;
    p.style.setProperty('--x', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--y', `${Math.sin(angle) * dist}px`);
    p.style.setProperty('--r', `${Math.round(Math.random() * 540 - 270)}deg`);
    p.style.background = PARTICLE_COLORS[i % PARTICLE_COLORS.length] as string;
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1000);
};

/** Inclinação 3D + brilho que segue o ponteiro nos cards. Delegado em `document`: serve cards criados depois. */
export const installCardTilt = (): void => {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  let active: HTMLElement | null = null;
  const reset = (): void => {
    active?.style.removeProperty('--rx');
    active?.style.removeProperty('--ry');
    active = null;
  };
  document.addEventListener('pointermove', (e) => {
    if (calm()) return;
    const card = (e.target as Element | null)?.closest<HTMLElement>('.card:not(.is-selected)');
    if (!card || card.closest('.as-list')) {
      reset();
      return;
    }
    if (card !== active) reset();
    active = card;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    card.style.setProperty('--rx', `${((0.5 - py) * 9).toFixed(2)}deg`);
    card.style.setProperty('--ry', `${((px - 0.5) * 9).toFixed(2)}deg`);
    card.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    card.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
  });
  document.addEventListener('pointerleave', reset);
  document.addEventListener('pointerout', (e) => {
    if (active && !active.contains(e.relatedTarget as Node | null)) reset();
  });
};
