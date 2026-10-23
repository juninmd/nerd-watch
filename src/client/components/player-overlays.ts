import { escapeHtml } from './card.ts';
import { icon } from '../icons.ts';

export interface OverlayView {
  remove(): void;
  setRemaining?(seconds: number): void;
}

/** Autoplay bloqueado: o botão recebe o foco (leitor de tela anuncia) e o toque dele é o gesto que o navegador exige. */
export const showTapToPlay = (host: HTMLElement, onPlay: () => void): OverlayView => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'player-overlay player-tap';
  button.setAttribute('aria-label', 'Toque para reproduzir');
  button.innerHTML = `${icon('play')}<span>Toque para reproduzir</span>`;
  button.addEventListener('click', () => onPlay());
  host.appendChild(button);
  button.focus({ preventScroll: true });
  return { remove: () => button.remove() };
};

export interface UpNextOptions {
  title: string;
  remaining: number;
  onPlayNow(): void;
  onCancel(): void;
}

/**
 * Próximo vídeo com contagem cancelável. O texto estático fica numa região `aria-live="polite"` (anunciado uma vez);
 * o número visível muda a cada segundo mas fica `aria-hidden`, para não narrar a contagem inteira.
 */
export const showUpNext = (host: HTMLElement, opts: UpNextOptions): OverlayView => {
  const card = document.createElement('div');
  card.className = 'player-overlay player-upnext';
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  card.innerHTML = `
    <span class="sr-only">Próximo vídeo: ${escapeHtml(opts.title)}. Começa em ${opts.remaining} segundos. Cancelar disponível.</span>
    <span class="upnext-text" aria-hidden="true"><small>Próximo vídeo</small><b>${escapeHtml(opts.title)}</b><span class="upnext-count">começa em <span data-count>${opts.remaining}</span>s</span></span>
    <span class="upnext-actions">
      <button type="button" class="btn btn-primary btn-sm" data-act="play-now">Reproduzir agora</button>
      <button type="button" class="btn btn-ghost btn-sm" data-act="cancel">Cancelar</button>
    </span>`;
  card.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'play-now') opts.onPlayNow();
    else if (act === 'cancel') opts.onCancel();
  });
  host.appendChild(card);
  const count = card.querySelector('[data-count]') as HTMLElement;
  return {
    remove: () => card.remove(),
    setRemaining: (seconds) => {
      count.textContent = String(seconds);
    },
  };
};
