import { Button } from '@juninmd/sonido';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/icon.tsx';
import type { DockItem } from './dock-item.ts';
import { getNowPlaying, getVideo, minimizePlayer, showInPage } from './player-dock.ts';
import { PlayerStage } from './player-stage.tsx';
import { usePlayerUi } from './player-ui-store.ts';

export interface InlinePlayerOptions {
  item: DockItem;
  /** Oferece "Minimizar" (continua tocando na barra fixa ao navegar). Desligado quando a fonte morre com a tela (ex.: torrent). */
  minimizable?: boolean;
  /** O navegador não toca esse arquivo (formato/codec): quem chama decide o plano B, por exemplo o embed da Archive. */
  onUnsupported?: () => void;
  /** Começa deste segundo (troca de fonte no meio do vídeo); sem ele, vale a posição salva. */
  startAt?: number | null;
}

const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

/**
 * O player global (o mesmo da tela de reprodução dos canais) embutido numa página qualquer: palco 16:9, posição salva e,
 * se permitido, "Minimizar". Só existe um `<video>` no app: se outro vídeo assumir o palco, este mostra um aviso com o
 * botão para retomar.
 */
export function InlinePlayer({ item, minimizable, onUnsupported, startAt }: InlinePlayerOptions) {
  usePlayerUi();
  const [stage, setStage] = useState<HTMLElement | null>(null);
  // O item e o callback mais recentes, sem reabrir o vídeo a cada render de quem chama.
  const latest = useRef({ item, onUnsupported });
  latest.current = { item, onUnsupported };
  const claim = () => stage && showInPage([latest.current.item], 0, stage);

  // reabre só quando o palco nasce ou o vídeo muda de chave
  useEffect(() => {
    if (stage) showInPage([latest.current.item], 0, stage, { startAt });
  }, [stage, item.key]);

  useEffect(() => {
    const video = getVideo();
    if (!video) return;
    const onError = () => {
      const code = video.error?.code;
      const unsupported = code === MEDIA_ERR_SRC_NOT_SUPPORTED || code === MEDIA_ERR_DECODE;
      if (unsupported && getNowPlaying()?.item.key === latest.current.item.key) latest.current.onUnsupported?.();
    };
    video.addEventListener('error', onError);
    return () => video.removeEventListener('error', onError);
  }, []);

  const now = getNowPlaying();
  const mine = now?.item.key === item.key;
  const onStage = mine && now?.mode === 'page';
  return (
    <div className="inline-player">
      <PlayerStage onStage={setStage}>
        {!onStage && (
          <div className="inline-overlay">
            <div className="inline-overlay-card">
              <small>{mine ? 'Minimizado na barra do player.' : 'Outro vídeo está tocando.'}</small>
              <Button variant="primary" size="sm" iconStart={<Icon name="play" size="sm" />} onClick={claim}>
                {mine ? 'Trazer de volta' : 'Reproduzir este'}
              </Button>
            </div>
          </div>
        )}
      </PlayerStage>
      {minimizable && (
        <div className="inline-actions">
          <Button variant="ghost" size="sm" iconStart={<Icon name="minimize" size="sm" />} onClick={minimizePlayer}>
            Minimizar
          </Button>
        </div>
      )}
    </div>
  );
}
