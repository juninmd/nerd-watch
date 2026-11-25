import { Alert, Button, Dialog, Select, Slider } from '@juninmd/sonido';
import { useEffect, useRef, useState } from 'react';
import type { CastSessionDto } from '../api/cast.ts';
import { Icon } from '../ui/icon.tsx';
import { openDialog } from '../app/open-dialog.ts';
import { CAST_SEEK_STEP_S, type CastController, type CastState } from './player-cast.ts';
import { formatDeviceSubtitle, remotePlaybackView } from './player-cast-model.ts';
import { usePlayerUi } from './player-ui-store.ts';

/** Arrastar a barra manda um seek só quando o usuário para de mexer (antes era o `change` do range nativo). */
const SEEK_SETTLE_MS = 350;

function RemoteControl({ cast, s, active }: { cast: CastController; s: CastState; active: CastSessionDto }) {
  const view = remotePlaybackView(s.playback);
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const onSeek = (v: number) => {
    setDraft(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setDraft(null);
      cast.seekRatio(v / 1000);
    }, SEEK_SETTLE_MS);
  };
  return (
    <div className="cast-remote">
      <div className="cast-remote-head">
        <div>
          <b>{active.device?.name ?? 'TV na rede local'}</b>
          <div className="cast-remote-status">{view.statusLabel}</div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={s.busy}
          iconStart={<Icon name="stop" size="sm" />}
          onClick={() => void cast.stop()}
        >
          Parar
        </Button>
      </div>
      {view.hasDuration ? (
        <Slider
          className="cast-remote-seek"
          label="Posição na TV"
          min={0}
          max={1000}
          value={draft ?? view.sliderValue}
          format={() => view.timeLabel}
          onChange={onSeek}
        />
      ) : (
        <div className="cast-remote-time">{view.timeLabel}</div>
      )}
      <div className="cast-remote-actions">
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Voltar ${CAST_SEEK_STEP_S} segundos`}
          disabled={s.busy}
          iconStart={<Icon name="replay10" size="sm" />}
          onClick={() => cast.seekBy(-CAST_SEEK_STEP_S)}
        >
          -10s
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={s.busy}
          iconStart={<Icon name={view.playing ? 'pause' : 'play'} size="sm" />}
          onClick={view.playing ? cast.pause : cast.play}
        >
          {view.playing ? 'Pausar' : 'Reproduzir'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Avançar ${CAST_SEEK_STEP_S} segundos`}
          disabled={s.busy}
          iconStart={<Icon name="forward10" size="sm" />}
          onClick={() => cast.seekBy(CAST_SEEK_STEP_S)}
        >
          +10s
        </Button>
      </div>
    </div>
  );
}

function QrSection({ cast, s }: { cast: CastController; s: CastState }) {
  const active = s.session;
  if (!active) {
    return (
      <div className="cast-section">
        <div className="cast-section-head">
          <h3>Navegador da TV ou QR Code</h3>
        </div>
        <p className="hint">
          Funciona em qualquer Smart TV (mesmo sem DLNA), Apple TV, Fire TV ou celular no mesmo Wi-Fi.
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={s.busy}
          iconStart={<Icon name="monitor" size="sm" />}
          onClick={() => void cast.launch()}
        >
          Gerar QR Code e link na rede local
        </Button>
      </div>
    );
  }
  return (
    <div className="cast-section">
      <div className="cast-section-head">
        <h3>Link e QR Code na rede local</h3>
        {!active.device && (
          <Button variant="ghost" size="sm" disabled={s.busy} onClick={() => void cast.stop()}>
            Encerrar link
          </Button>
        )}
      </div>
      <div className="cast-qr-box">
        <img className="cast-qr-img" src={active.qrDataUrl} alt="QR Code para abrir o vídeo na TV" />
        <div className="cast-qr-info">
          <p className="cast-url">{active.watchUrl}</p>
          <div className="cast-url-actions">
            <Button variant="primary" size="sm" onClick={() => cast.copy('watch')}>
              Copiar link da TV
            </Button>
            <Button variant="ghost" size="sm" onClick={() => cast.copy('media')}>
              Link direto (VLC/Kodi)
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeviceList({ cast, s }: { cast: CastController; s: CastState }) {
  if (s.scanning) return <p className="hint">Procurando TVs na sua rede Wi-Fi…</p>;
  if (s.devices.length === 0) {
    return (
      <p className="hint">
        Nenhuma TV DLNA encontrada automaticamente. Confirme se o computador e a TV estão no mesmo Wi-Fi ou use o QR
        Code abaixo.
      </p>
    );
  }
  return (
    <ul className="cast-devices">
      {s.devices.map((dev) => (
        <li key={dev.id} className="cast-device">
          <span className="cast-device-meta">
            <b>{dev.name}</b>
            <small>{formatDeviceSubtitle(dev)}</small>
          </span>
          <Button
            variant="primary"
            size="sm"
            disabled={s.busy}
            aria-label={`Enviar para ${dev.name}`}
            onClick={() => void cast.launch(dev.id)}
          >
            Enviar
          </Button>
        </li>
      ))}
    </ul>
  );
}

function CastDialog({ cast, onClose }: { cast: CastController; onClose(): void }) {
  usePlayerUi();
  const s = cast.state();
  return (
    <Dialog open onClose={onClose} title="Enviar para a TV" className="cast-dialog">
      <div className="cast-body">
        {s.item && <p className="cast-video-title">{s.item.title}</p>}
        {s.errorMsg && <Alert tone="danger">{s.errorMsg}</Alert>}
        {s.interfaces.length > 1 && (
          <Select
            className="cast-iface-row"
            label="Rede local"
            value={s.selectedHost}
            onChange={cast.setHost}
            options={s.interfaces.map((i) => ({ value: i.address, label: `${i.address} (${i.name})` }))}
          />
        )}
        {s.session?.device && <RemoteControl cast={cast} s={s} active={s.session} />}
        <div className="cast-section">
          <div className="cast-section-head">
            <h3>TVs encontradas no Wi-Fi</h3>
            <Button
              variant="ghost"
              size="sm"
              disabled={s.scanning}
              iconStart={<Icon name="refresh" size="sm" />}
              onClick={() => void cast.scan()}
            >
              Buscar
            </Button>
          </div>
          <DeviceList cast={cast} s={s} />
        </div>
        <QrSection cast={cast} s={s} />
        {s.hasNative && (
          <div className="cast-section">
            <Button variant="ghost" size="sm" iconStart={<Icon name="cast" size="sm" />} onClick={cast.native}>
              Transmitir pelo navegador (AirPlay / Chromecast)
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** Abre o diálogo na camada de overlays (o foco volta ao botão de transmitir); fechar avisa o controlador. */
export const openCastDialog = (cast: CastController): (() => void) =>
  openDialog(() => <CastDialog cast={cast} onClose={() => cast.closed()} />);
