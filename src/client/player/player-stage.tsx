import { type CSSProperties, type ReactNode, useCallback, useLayoutEffect, useState } from 'react';
import { getMediaBadge } from './media-fallback.ts';
import { PlayerOverlays } from './player-overlays.tsx';
import { CaptionsControl } from './player-captions-view.tsx';
import { getPageStage, releaseStage } from './player-dock.ts';
import { PageControls } from './player-page-controls.tsx';
import { usePlayerUi } from './player-ui-store.ts';

/** Selo com o caminho de reprodução (direto, remux, transcodificado) e o progresso da conversão. */
export function MediaBadge() {
  usePlayerUi();
  const { text, title } = getMediaBadge();
  return (
    <span className="media-badge" role="status" title={title || undefined} hidden={text === ''}>
      {text}
    </span>
  );
}

export interface PlayerStageProps {
  className?: string;
  style?: CSSProperties;
  /** Entrega o nó do palco quando monta (null ao desmontar): quem chama passa a `showInPage`. */
  onStage?(stage: HTMLElement | null): void;
  /** Camadas próprias da tela (iframe de embed, cartão de fim) por cima do vídeo. */
  children?: ReactNode;
}

/**
 * Palco 16:9 onde o `<video>` global aparece grande. O elemento é movido para cá por `showInPage`; se outro palco
 * assumir o vídeo, este fica só com as próprias camadas. Ao desmontar, o vídeo volta para a barra antes de o nó sair.
 */
export function PlayerStage({ className, style, onStage, children }: PlayerStageProps) {
  usePlayerUi();
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      setEl(node);
      onStage?.(node);
    },
    [onStage],
  );
  useLayoutEffect(
    () => () => {
      if (el) releaseStage(el);
    },
    [el],
  );
  const owns = el !== null && getPageStage() === el;
  return (
    <div ref={ref} className={`watch-stage media-host${className ? ` ${className}` : ''}`} style={style}>
      {children}
      {owns && (
        <>
          <MediaBadge />
          <PageControls stage={el} />
          <CaptionsControl />
          <PlayerOverlays />
        </>
      )}
    </div>
  );
}
