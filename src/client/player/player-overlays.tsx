import { Button } from '@juninmd/sonido';
import { useEffect, useRef } from 'react';
import { Icon } from '../ui/icon.tsx';
import { getOverlays } from './player-dock.ts';
import { usePlayerUi } from './player-ui-store.ts';

/** Autoplay bloqueado: o botão recebe o foco (leitor de tela anuncia) e o toque dele é o gesto que o navegador exige. */
function TapToPlay({ onPlay }: { onPlay(): void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <Button
      ref={ref}
      className="player-overlay player-tap"
      variant="primary"
      aria-label="Toque para reproduzir"
      iconStart={<Icon name="play" />}
      onClick={onPlay}
    >
      Toque para reproduzir
    </Button>
  );
}

/**
 * Próximo vídeo com contagem cancelável. O texto estático fica numa região `aria-live="polite"` (anunciado uma vez);
 * o número visível muda a cada segundo mas fica `aria-hidden`, para não narrar a contagem inteira.
 */
function UpNext({
  title,
  remaining,
  onPlayNow,
  onCancel,
}: {
  title: string;
  remaining: number;
  onPlayNow(): void;
  onCancel(): void;
}) {
  // O anúncio usa o número do começo da contagem: mudar o texto da região a cada segundo faria o leitor repetir.
  const announced = useRef(remaining);
  return (
    <div className="player-overlay player-upnext" role="status" aria-live="polite">
      <span className="sr-only">
        Próximo vídeo: {title}. Começa em {announced.current} segundos. Cancelar disponível.
      </span>
      <span className="upnext-text" aria-hidden="true">
        <small>Próximo vídeo</small>
        <b>{title}</b>
        <span className="upnext-count">começa em {remaining}s</span>
      </span>
      <span className="upnext-actions">
        <Button variant="primary" size="sm" onClick={onPlayNow}>
          Reproduzir agora
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
      </span>
    </div>
  );
}

/** Overlays do player no lugar onde o vídeo está (palco da página ou barra fixa); quem chama decide se desenha. */
export function PlayerOverlays() {
  usePlayerUi();
  const overlays = getOverlays();
  const state = overlays.state();
  if (!state) return null;
  if (state.kind === 'tap') return <TapToPlay onPlay={overlays.tap} />;
  return (
    <UpNext
      key={state.title}
      title={state.title}
      remaining={state.remaining}
      onPlayNow={overlays.playNow}
      onCancel={overlays.cancelUpNext}
    />
  );
}
