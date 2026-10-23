import { icon } from '../icons.ts';

/** Estrutura da barra fixa. O `<video>` nasce aqui e depois muda de lugar entre a barra e o palco da página. */
export const DOCK_MARKUP = `
    <section class="dock" aria-label="Player de vídeo" hidden>
      <div class="dock-video"><video playsinline tabindex="0" aria-label="Vídeo"></video></div>
      <div class="dock-info" aria-live="polite"><button class="dock-title" type="button"></button><small class="dock-sub"></small></div>
      <div class="dock-controls">
        <button type="button" data-act="prev" aria-label="Vídeo anterior">${icon('skipPrev')}</button>
        <button type="button" data-act="back" aria-label="Voltar 10 segundos">${icon('replay10')}</button>
        <button type="button" data-act="toggle" aria-label="Pausar">${icon('pause')}</button>
        <button type="button" data-act="fwd" aria-label="Avançar 10 segundos">${icon('forward10')}</button>
        <button type="button" data-act="next" aria-label="Próximo vídeo">${icon('skipNext')}</button>
        <button type="button" data-act="speed" class="dock-speed" aria-label="Velocidade de reprodução: 1x. Alterar">1x</button>
      </div>
      <input class="dock-seek" type="range" min="0" max="1000" value="0" aria-label="Posição do vídeo" />
      <span class="dock-time" aria-hidden="true"></span>
      <div class="dock-end">
        <button type="button" data-act="expand" aria-label="Abrir em tela cheia">${icon('expand')}</button>
        <button type="button" data-act="close" aria-label="Fechar player">${icon('x')}</button>
      </div>
    </section>`;
