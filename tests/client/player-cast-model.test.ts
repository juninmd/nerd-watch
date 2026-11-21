import { describe, expect, test } from 'bun:test';
import type { DockItem } from '../../src/client/player/player-dock.ts';
import {
  canCastItem,
  castSeekTarget,
  castStatusLabel,
  formatDeviceSubtitle,
  remotePlaybackView,
  resumeAfterCast,
} from '../../src/client/player/player-cast-model.ts';

const baseItem: DockItem = {
  key: 'ch:1',
  src: '/api/telegram/ch/items/1/stream',
  title: 'Filme',
  subtitle: 'Canal',
  poster: null,
  channelId: 'ch',
  messageId: '1',
  durationSeconds: 3600,
  route: '/watch/ch/1',
};

describe('player-cast-model', () => {
  test('canCastItem libera vídeo direto e bloqueia embed ou item vazio', () => {
    expect(canCastItem(baseItem)).toBe(true);
    expect(canCastItem({ ...baseItem, embedUrl: 'https://www.youtube.com/embed/abc' })).toBe(false);
    expect(canCastItem({ ...baseItem, src: '' })).toBe(false);
    expect(canCastItem(null)).toBe(false);
  });

  test('castStatusLabel traduz estados DLNA para pt-BR', () => {
    expect(castStatusLabel('PLAYING')).toBe('Reproduzindo na TV');
    expect(castStatusLabel('PAUSED_PLAYBACK')).toBe('Pausado na TV');
    expect(castStatusLabel('TRANSITIONING')).toBe('Carregando na TV…');
    expect(castStatusLabel('STOPPED')).toBe('Parado na TV');
    expect(castStatusLabel('UNKNOWN')).toBe('Conectado à TV');
  });

  test('formatDeviceSubtitle combina fabricante, modelo e IP', () => {
    expect(
      formatDeviceSubtitle({ id: '1', name: 'TV', manufacturer: 'Samsung', model: 'Q60', host: '192.168.1.22' }),
    ).toBe('Samsung · Q60 · 192.168.1.22');
    expect(formatDeviceSubtitle({ id: '2', name: 'TV', manufacturer: '', model: '', host: '192.168.1.23' })).toBe(
      '192.168.1.23',
    );
  });

  test('castSeekTarget respeita 0 e duração total', () => {
    expect(castSeekTarget(5, -10, 100)).toBe(0);
    expect(castSeekTarget(95, 10, 100)).toBe(100);
    expect(castSeekTarget(30, 10, null)).toBe(40);
    expect(castSeekTarget(null, 10, 100)).toBe(10);
  });

  test('remotePlaybackView calcula progresso, rótulo e slider limitado a 0..1000', () => {
    expect(remotePlaybackView({ state: 'PLAYING', positionSeconds: 90, durationSeconds: 180 })).toEqual({
      playing: true,
      statusLabel: 'Reproduzindo na TV',
      hasDuration: true,
      sliderValue: 500,
      timeLabel: '1:30 / 3:00',
    });
    expect(remotePlaybackView({ state: 'PAUSED_PLAYBACK', positionSeconds: 250, durationSeconds: 180 }).sliderValue).toBe(1000);
    expect(remotePlaybackView({ state: 'TRANSITIONING', positionSeconds: 0, durationSeconds: null })).toEqual({
      playing: false,
      statusLabel: 'Carregando na TV…',
      hasDuration: false,
      sliderValue: 0,
      timeLabel: '0:00',
    });
  });
});

describe('resumeAfterCast', () => {
  test('volta o player local para onde a TV parou', () => {
    expect(resumeAfterCast({ state: 'PAUSED_PLAYBACK', positionSeconds: 102.7, durationSeconds: 3600 })).toBe(102);
  });

  test('sem posição conhecida (ou zero) não mexe no vídeo', () => {
    expect(resumeAfterCast(null)).toBeNull();
    expect(resumeAfterCast({ state: 'UNKNOWN', positionSeconds: null, durationSeconds: null })).toBeNull();
    expect(resumeAfterCast({ state: 'STOPPED', positionSeconds: 0, durationSeconds: null })).toBeNull();
    expect(resumeAfterCast({ state: 'PLAYING', positionSeconds: Number.NaN, durationSeconds: null })).toBeNull();
  });
});
