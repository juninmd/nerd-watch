import { Button, Menu, Slider } from '@juninmd/sonido';
import { type CSSProperties, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../ui/icon.tsx';
import { formatDuration } from '../ui/time-format.ts';
import { canStep, getCast, getVideo, stepPlayer, togglePlay } from './player-dock.ts';
import { seekVideo } from './player-keyboard.ts';
import { progressFraction, SEEK_SECONDS, SPEED_STEPS } from './player-seek.ts';
import { clockLabel } from './player-clock.ts';
import { getSourceMenu, subscribeSourceMenu } from './player-sources.ts';
import { usePlayerUi } from './player-ui-store.ts';
import { activeSegment, getSkipSegments, SKIP_LABEL, subscribeSkipSegments } from './skip-segments.ts';

const IDLE_MS = 2800;
const SEEK_STEPS = 1000;

const bufferedEnd = (v: HTMLVideoElement): number => {
  for (let i = 0; i < v.buffered.length; i += 1) {
    if (v.buffered.start(i) <= v.currentTime && v.currentTime <= v.buffered.end(i)) return v.buffered.end(i);
  }
  return v.currentTime;
};

const toggleStageFullscreen = (stage: HTMLElement): void => {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else void stage.requestFullscreen?.().catch(() => undefined);
};

const togglePip = (video: HTMLVideoElement): void => {
  if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
  else void video.requestPictureInPicture?.().catch(() => undefined);
};

/**
 * Controles da tela de reprodução (palco grande), no lugar da barra nativa do navegador. Mouse parado esconde a barra
 * enquanto toca; qualquer movimento, foco ou pausa traz de volta. Só o palco dono do `<video>` desenha esta barra.
 */
export function PageControls({ stage }: { stage: HTMLElement }) {
  usePlayerUi();
  const segments = useSyncExternalStore(subscribeSkipSegments, getSkipSegments);
  const sources = useSyncExternalStore(subscribeSourceMenu, getSourceMenu);
  const video = getVideo();
  const root = useRef<HTMLDivElement>(null);
  const [idle, setIdle] = useState(false);
  const [, setFullscreen] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playing = !!video && !video.paused && !video.ended;

  const wake = useCallback((): void => {
    setIdle(false);
    stage.classList.remove('pc-hide-cursor');
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      const v = getVideo();
      // Foco na barra (inclui o menu de velocidade aberto) mantém os controles à vista.
      if (!v || v.paused || root.current?.contains(document.activeElement)) return;
      setIdle(true);
      stage.classList.add('pc-hide-cursor');
    }, IDLE_MS);
  }, [stage]);

  useEffect(() => {
    if (!playing) wake();
  }, [playing, wake]);

  useEffect(() => {
    const v = getVideo();
    if (!v) return;
    const abort = new AbortController();
    const { signal } = abort;
    // Clique no vídeo: mouse alterna play/pause; toque só mostra a barra (o duplo toque é o salto de 10 s).
    v.addEventListener('click', (e) => ((e as PointerEvent).pointerType === 'touch' ? wake() : togglePlay()), {
      signal,
    });
    // No toque, o duplo toque é salto de 10 s: tela cheia por duplo clique só com mouse.
    v.addEventListener('dblclick', () => matchMedia('(pointer: fine)').matches && toggleStageFullscreen(stage), {
      signal,
    });
    document.addEventListener('fullscreenchange', () => setFullscreen(document.fullscreenElement === stage), {
      signal,
    });
    for (const type of ['pointermove', 'pointerdown', 'focusin', 'keydown'])
      stage.addEventListener(type, wake, { signal });
    stage.addEventListener('pointerleave', () => !getVideo()?.paused && setIdle(true), { signal });
    wake();
    return () => {
      abort.abort();
      if (idleTimer.current) clearTimeout(idleTimer.current);
      stage.classList.remove('pc-hide-cursor');
    };
  }, [stage, wake]);

  if (!video) return null;
  const d = Number.isFinite(video.duration) ? video.duration : 0;
  const played = progressFraction(video.currentTime, d);
  const now = formatDuration(Math.floor(video.currentTime)) ?? '0:00';
  const total = d ? formatDuration(Math.floor(d)) : null;
  const timeText = total ? `${now} / ${total}` : now;
  const silent = video.muted || video.volume === 0;
  const rate = video.playbackRate;
  const full = document.fullscreenElement === stage;
  const casting = getCast()?.isActive() ?? false;
  const seekStyle = { '--buffered': `${progressFraction(bufferedEnd(video), d) * 100}%` } as CSSProperties;
  const skip = activeSegment(segments, video.currentTime);

  return (
    <>
      {/* Fora da barra: continua à vista com os controles escondidos, como nos apps de streaming. */}
      {skip && (
        <Button
          className="pc-skip"
          variant="secondary"
          iconEnd={<Icon name="skipNext" size="sm" />}
          onClick={() => {
            video.currentTime = skip.end;
          }}
        >
          {SKIP_LABEL[skip.kind]}
        </Button>
      )}
      <div ref={root} className={`pc${idle ? ' pc-idle' : ''}`}>
        <div className="pc-bar">
          <div className="pc-seekwrap" style={seekStyle}>
            {d > 0 &&
              segments.map((seg) => (
                <span
                  key={`${seg.kind}:${seg.start}`}
                  className={`pc-seg is-${seg.kind}`}
                  aria-hidden="true"
                  style={{ left: `${(seg.start / d) * 100}%`, width: `${((seg.end - seg.start) / d) * 100}%` }}
                />
              ))}
            <Slider
              className="pc-seek"
              label="Posição do vídeo"
              min={0}
              max={SEEK_STEPS}
              value={Math.round(played * SEEK_STEPS)}
              format={() => (total ? `${now} de ${total}` : now)}
              onChange={(v) => {
                if (d) video.currentTime = (v / SEEK_STEPS) * d;
              }}
            />
          </div>
          <div className="pc-row">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Vídeo anterior"
              disabled={!canStep(-1)}
              onClick={() => stepPlayer(-1)}
            >
              <Icon name="skipPrev" />
            </Button>
            <Button variant="ghost" size="icon" aria-label={playing ? 'Pausar' : 'Reproduzir'} onClick={togglePlay}>
              <Icon name={playing ? 'pause' : 'play'} />
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
              className="pc-seekbtn"
              variant="ghost"
              size="icon"
              aria-label={`Voltar ${SEEK_SECONDS} segundos`}
              onClick={() => seekVideo(video, -SEEK_SECONDS)}
            >
              <Icon name="replay10" />
            </Button>
            <Button
              className="pc-seekbtn"
              variant="ghost"
              size="icon"
              aria-label={`Avançar ${SEEK_SECONDS} segundos`}
              onClick={() => seekVideo(video, SEEK_SECONDS)}
            >
              <Icon name="forward10" />
            </Button>
            <span className="pc-volume">
              <Button
                variant="ghost"
                size="icon"
                aria-label={silent ? 'Ativar som' : 'Silenciar'}
                onClick={() => (video.muted = !video.muted)}
              >
                <Icon name={silent ? 'volumeMute' : 'volume'} />
              </Button>
              <Slider
                className="pc-vol"
                label="Volume"
                value={Math.round((silent ? 0 : video.volume) * 100)}
                format={(n) => `${n}%`}
                onChange={(v) => {
                  video.volume = v / 100;
                  video.muted = video.volume === 0;
                }}
              />
            </span>
            <span className="pc-time" aria-hidden="true">
              {timeText}
            </span>
            <span className="pc-clock" aria-hidden="true">
              {clockLabel(new Date(), video.currentTime, d, rate)}
            </span>
            <span className="pc-spacer" />
            {sources && (
              <Menu
                className="pc-sourcewrap"
                align="end"
                trigger={<span className="pc-speed">{sources.options.find((o) => o.active)?.label.split(' · ')[0] ?? 'Fonte'}</span>}
                triggerLabel="Fonte e qualidade"
                items={sources.options.map((o) => ({
                  key: `${o.addonId}:${o.index}`,
                  label: o.label,
                  icon: o.active ? <Icon name="check" size="sm" /> : undefined,
                  onSelect: () => sources.select(o),
                }))}
              />
            )}
            <Menu
              className="pc-speedwrap"
              align="end"
              trigger={<span className="pc-speed">{rate}x</span>}
              triggerLabel={`Velocidade de reprodução: ${rate}x`}
              items={SPEED_STEPS.map((s) => ({
                key: String(s),
                label: s === 1 ? 'Normal' : `${s}x`,
                icon: s === rate ? <Icon name="check" size="sm" /> : undefined,
                onSelect: () => {
                  video.playbackRate = s;
                },
              }))}
            />
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
            {document.pictureInPictureEnabled && (
              <Button variant="ghost" size="icon" aria-label="Picture-in-picture" onClick={() => togglePip(video)}>
                <Icon name="pip" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={full ? 'Sair da tela cheia' : 'Tela cheia'}
              onClick={() => toggleStageFullscreen(stage)}
            >
              <Icon name={full ? 'minimize' : 'expand'} />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
