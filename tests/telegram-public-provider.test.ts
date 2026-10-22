import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { TelegramChannelNotFoundError, decodeEntities, isTelegramPhotoUrl, parsePublicChannelHtml, parsePublicChannelInfo } from '../src/server/providers/telegram/public.ts';

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

  test('casa o handle sem diferenciar maiúsculas/minúsculas (usernames do Telegram não fazem distinção)', () => {
    const items = parsePublicChannelHtml(FIXTURE, 'CanalTeste');
    expect(items).toHaveLength(2);
  });

  test('lança TelegramChannelNotFoundError quando a página não tem marcação de canal válido', () => {
    expect(() => parsePublicChannelHtml('<html><body>não existe</body></html>', 'canalteste')).toThrow(
      TelegramChannelNotFoundError,
    );
  });
});

describe('parsePublicChannelInfo', () => {
  test('lê nome, foto e descrição do cabeçalho, mantendo as quebras de linha e decodificando entidades', () => {
    expect(parsePublicChannelInfo(FIXTURE)).toEqual({
      title: 'Canal de Teste',
      photoUrl: 'https://cdn1.telesco.pe/file/avatar-teste.png',
      description: 'Série fictícia\nsegunda linha & mais',
    });
  });

  test('campos ausentes viram null em vez de quebrar', () => {
    expect(parsePublicChannelInfo('<html></html>')).toEqual({ title: null, photoUrl: null, description: null });
  });

  test('ignora foto hospedada fora dos CDNs do Telegram (o servidor a baixaria depois)', () => {
    const html = FIXTURE.replace('https://cdn1.telesco.pe/file/avatar-teste.png', 'https://evil.example/a.png');
    expect(parsePublicChannelInfo(html).photoUrl).toBeNull();
  });
});

describe('isTelegramPhotoUrl', () => {
  test.each(['https://cdn1.telesco.pe/file/x.jpg', 'https://cdn4.cdn-telegram.org/file/x.jpg', 'https://t.me/i/userpic/x.jpg'])('aceita %s', (url) => {
    expect(isTelegramPhotoUrl(url)).toBe(true);
  });

  test.each([
    'http://cdn1.telesco.pe/file/x.jpg',
    'https://evil-telesco.pe/x.jpg',
    'https://telesco.pe.evil.com/x.jpg',
    'https://127.0.0.1/x.jpg',
    'file:///etc/passwd',
    'não é url',
  ])('recusa %s', (url) => {
    expect(isTelegramPhotoUrl(url)).toBe(false);
  });
});

describe('decodeEntities', () => {
  test('decodifica entidades nomeadas e numéricas (decimal e hexadecimal)', () => {
    expect(decodeEntities('cala&#33; &#x21; &quot;oi&quot; &amp; tchau &#39;x&#39;')).toBe('cala! ! "oi" & tchau \'x\'');
  });

  test('não decodifica em dobro: &amp;lt; vira o texto "&lt;", não "<"', () => {
    expect(decodeEntities('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
  });

  test('deixa passar entidades desconhecidas ou inválidas sem quebrar', () => {
    expect(decodeEntities('&foo; &#0; &#99999999;')).toBe('&foo; &#0; &#99999999;');
  });

  test('emoji por código numérico', () => {
    expect(decodeEntities('&#128512;')).toBe('😀');
  });
});
