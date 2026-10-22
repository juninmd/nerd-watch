import { icon } from '../icons.ts';
import { type DockItem, getNowPlaying, getVideo, minimizePlayer, showInPage, subscribePlayer } from './player-dock.ts';

export interface InlinePlayerOptions {
  item: DockItem;
  /** Oferece "Minimizar" (continua tocando na barra fixa ao navegar). Desligado quando a fonte morre com a tela (ex.: torrent). */
  minimizable?: boolean;
  /** O navegador não toca esse arquivo (formato/codec): quem chama decide o plano B, por exemplo o embed da Archive. */
  onUnsupported?: () => void;
}

const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

/**
 * O player global (o mesmo da tela de reprodução dos canais) embutido numa página qualquer: palco 16:9 com os controles
 * do navegador, posição salva e, se permitido, "Minimizar". Só existe um `<video>` no app: se outro vídeo assumir o palco,
 * este mostra um aviso com o botão para retomar.
 */
export const renderInlinePlayer = (opts: InlinePlayerOptions): HTMLElement => {
  const { item } = opts;
  const root = document.createElement('div');
  root.className = 'inline-player';
  root.innerHTML = `
    <div class="watch-stage"><div class="inline-overlay" hidden></div></div>
    ${opts.minimizable ? `<div class="inline-actions"><button class="btn btn-ghost btn-sm" data-act="minimize" type="button">${icon('minimize', 'sm')} Minimizar</button></div>` : ''}`;
  const stage = root.querySelector('.watch-stage') as HTMLElement;
  const overlay = root.querySelector('.inline-overlay') as HTMLElement;

  const claim = () => showInPage([item], 0, stage);

  const paint = () => {
    const now = getNowPlaying();
    const mine = now?.item.key === item.key;
    if (mine && now?.mode === 'page') {
      overlay.hidden = true;
      return;
    }
    overlay.hidden = false;
    const message = mine ? 'Minimizado na barra do player.' : 'Outro vídeo está tocando.';
    overlay.innerHTML = `<div class="inline-overlay-card"><small>${message}</small><button class="btn btn-primary btn-sm" data-act="claim" type="button">${icon('play', 'sm')} ${mine ? 'Trazer de volta' : 'Reproduzir este'}</button></div>`;
  };

  root.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'minimize') minimizePlayer();
    else if (act === 'claim') claim();
  });

  claim();
  const video = getVideo();
  const onError = () => {
    if (!root.isConnected) return video?.removeEventListener('error', onError);
    const code = video?.error?.code;
    if ((code === MEDIA_ERR_SRC_NOT_SUPPORTED || code === MEDIA_ERR_DECODE) && getNowPlaying()?.item.key === item.key) opts.onUnsupported?.();
  };
  if (opts.onUnsupported) video?.addEventListener('error', onError);

  const unsubscribe = subscribePlayer(() => {
    if (!root.isConnected) {
      unsubscribe();
      video?.removeEventListener('error', onError);
      return;
    }
    paint();
  });
  paint();
  return root;
};
