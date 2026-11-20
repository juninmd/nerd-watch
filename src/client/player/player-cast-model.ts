import type { CastDeviceDto, DlnaTransportState } from '../api/cast.ts';
import type { DockItem } from './player-dock.ts';
import { playerKindOf } from './watch-embed.ts';

/** Só vídeos diretos (`<video>`) podem ir para a TV pelo relay LAN; embeds em iframe (YouTube) não expõem o fluxo. */
export const canCastItem = (item: DockItem | null | undefined): boolean =>
  Boolean(item && playerKindOf(item) !== 'embed' && item.src.trim() !== '');

export const castStatusLabel = (state: DlnaTransportState | null | undefined): string => {
  switch (state) {
    case 'PLAYING':
      return 'Reproduzindo na TV';
    case 'PAUSED_PLAYBACK':
      return 'Pausado na TV';
    case 'TRANSITIONING':
      return 'Carregando na TV…';
    case 'STOPPED':
    case 'NO_MEDIA_PRESENT':
      return 'Parado na TV';
    default:
      return 'Conectado à TV';
  }
};

export const formatDeviceSubtitle = (dev: CastDeviceDto): string => {
  const parts = [dev.manufacturer, dev.model].map((s) => s.trim()).filter(Boolean);
  const info = parts.join(' · ');
  return info ? `${info} · ${dev.host}` : dev.host;
};

/** Calcula o alvo de salto no controle remoto da TV, preso entre 0 e a duração conhecida. */
export const castSeekTarget = (current: number | null, delta: number, duration: number | null): number => {
  const base = current !== null && Number.isFinite(current) ? current : 0;
  const next = Math.max(0, base + delta);
  if (duration !== null && Number.isFinite(duration) && duration > 0) return Math.min(duration, next);
  return next;
};
