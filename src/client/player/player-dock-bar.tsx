import { Button, Slider } from '@juninmd/sonido';
import { navigate } from '../app/router.ts';
import { Icon } from '../ui/icon.tsx';
import { formatDuration } from '../ui/time-format.ts';
import { CaptionsControl } from './player-captions-view.tsx';
import {
  attachDockSlot,
  canStep,
  getCast,
  getDockSubtitle,
  getNowPlaying,
  getVideo,
  stepPlayer,
  stopPlayer,
  togglePlay,
} from './player-dock.ts';
import { seekVideo } from './player-keyboard.ts';
import { PlayerOverlays } from './player-overlays.tsx';
import { MAX_SPEED, MIN_SPEED, nextSpeed, SEEK_SECONDS } from './player-seek.ts';
import { MediaBadge } from './player-stage.tsx';
import { usePlayerUi } from './player-ui-store.ts';

const SEEK_STEPS = 1000;

const timeLabel = (video: HTMLVideoElement, d: number): string =>
  `${formatDuration(Math.floor(video.currentTime)) ?? '0:00'}${d ? ` / ${formatDuration(Math.floor(d))}` : ''}`;

/**
 * Barra fixa do player, montada uma vez pela casca: só aparece depois de "Minimizar". A vaga `.dock-video` guarda o
 * `<video>` global enquanto nenhum palco o mostra grande (o elemento nasce aqui, em `attachDockSlot`).
 */
export function PlayerDock() {
  usePlayerUi();
  const now = getNowPlaying();
  const video = getVideo();
  const docked = now?.mode === 'dock';
  const playing = !!video && !video.paused && !video.ended;
  const d = video && Number.isFinite(video.duration) ? video.duration : 0;
  const rate = video?.playbackRate ?? 1;
  const casting = getCast()?.isActive() ?? false;
  const expand = () => now && navigate(now.item.route);

  return (
    // `#dock` fica fora da transição de tela (effects.css): o vídeo não pisca nem congela ao navegar.
    <div id="dock">
      <section className="dock" aria-label="Player de vídeo" hidden={!docked}>
        <div className="dock-video media-host" ref={attachDockSlot}>
          {docked && <MediaBadge />}
        </div>
        <div className="dock-info" aria-live="polite">
          <Button className="dock-title" variant="link" onClick={expand}>
            {now?.item.title ?? ''}
          </Button>
          <small className="dock-sub">{getDockSubtitle()}</small>
        </div>
        <div className="dock-controls">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Vídeo anterior"
            disabled={!canStep(-1)}
            onClick={() => stepPlayer(-1)}
          >
            <Icon name="skipPrev" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Voltar 10 segundos"
            onClick={() => video && seekVideo(video, -SEEK_SECONDS)}
          >
            <Icon name="replay10" />
          </Button>
          <Button
            className="dock-toggle"
            variant="primary"
            size="icon"
            aria-label={playing ? 'Pausar' : 'Reproduzir'}
            onClick={togglePlay}
          >
            <Icon name={playing ? 'pause' : 'play'} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Avançar 10 segundos"
            onClick={() => video && seekVideo(video, SEEK_SECONDS)}
          >
            <Icon name="forward10" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Próximo vídeo"
            disabled={!canStep(1)}
            onClick={() => stepPlayer(1)}
          >
            <Icon name="skipNext" />
          </Button>
          <Button
            className="dock-speed"
            variant="ghost"
            size="sm"
            aria-label={`Velocidade de reprodução: ${rate}x. Alterar`}
            onClick={() => {
              if (video)
                video.playbackRate = video.playbackRate >= MAX_SPEED ? MIN_SPEED : nextSpeed(video.playbackRate, 1);
            }}
          >
            {rate}x
          </Button>
          {docked && <CaptionsControl />}
        </div>
        <Slider
          className="dock-seek"
          label="Posição do vídeo"
          min={0}
          max={SEEK_STEPS}
          value={video && d ? Math.round((video.currentTime / d) * SEEK_STEPS) : 0}
          format={() => (video ? timeLabel(video, d) : '0:00')}
          onChange={(v) => {
            if (video && d) video.currentTime = (v / SEEK_STEPS) * d;
          }}
        />
        <span className="dock-time" aria-hidden="true">
          {video ? timeLabel(video, d) : ''}
        </span>
        <div className="dock-end">
          <Button
            className={casting ? 'cast-active' : undefined}
            variant="ghost"
            size="icon"
            aria-label="Enviar para a TV"
            aria-pressed={casting}
            onClick={() => getCast()?.open()}
          >
            <Icon name="cast" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Abrir em tela cheia" onClick={expand}>
            <Icon name="expand" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Fechar player" onClick={stopPlayer}>
            <Icon name="x" />
          </Button>
        </div>
        {docked && <PlayerOverlays />}
      </section>
    </div>
  );
}
