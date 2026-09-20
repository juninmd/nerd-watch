import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { TelegramChannelNotFoundError, parsePublicChannelHtml } from '../src/server/providers/telegram/public.ts';

const FIXTURE = readFileSync(`${import.meta.dir}/fixtures/telegram-public-channel.html`, 'utf-8');

describe('parsePublicChannelHtml', () => {
  test('extrai só os posts com vídeo, ignorando texto puro', () => {
    const items = parsePublicChannelHtml(FIXTURE, 'canalteste');
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.messageId)).toEqual(['100', '102']);
  });

  test('decodifica a URL do vídeo (entidades HTML) e a mantém jogável', () => {
    const items = parsePublicChannelHtml(FIXTURE, 'canalteste');
    expect(items[0]?.videoUrl).toBe('https://cdn1.telesco.pe/file/video100.mp4?token=abc123&x=1');
  });

  test('converte duração "hh:mm:ss" e "mm:ss" pra segundos', () => {
    const items = parsePublicChannelHtml(FIXTURE, 'canalteste');
    expect(items[0]?.durationSeconds).toBe(1 * 3600 + 23 * 60 + 45);
    expect(items[1]?.durationSeconds).toBe(5 * 60 + 2);
  });

  test('extrai legenda, thumbnail e data quando presentes, e null quando ausentes', () => {
    const items = parsePublicChannelHtml(FIXTURE, 'canalteste');
    expect(items[0]?.caption).toBe('Episódio 1 — piloto');
    expect(items[0]?.thumbnailUrl).toBe('https://cdn1.telesco.pe/file/thumb100.jpg');
    expect(items[0]?.postedAt).toBe('2026-01-01T10:00:00+00:00');
    expect(items[1]?.caption).toBeNull();
  });

  test('ignora posts de outro canal (handle não bate)', () => {
    const items = parsePublicChannelHtml(FIXTURE, 'outro-canal');
    expect(items).toHaveLength(0);
  });

  test('lança TelegramChannelNotFoundError quando a página não tem marcação de canal válido', () => {
    expect(() => parsePublicChannelHtml('<html><body>não existe</body></html>', 'canalteste')).toThrow(
      TelegramChannelNotFoundError,
    );
  });
});
