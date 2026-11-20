import { describe, expect, test } from 'bun:test';
import { isNoticeVideo } from '../../src/server/providers/stremio/notice-video.ts';
import { decodeEntities } from '../../src/server/providers/stremio/text.ts';

/**
 * Texto e "streams" que o addon manda crus. Duas armadilhas medidas no addon de torrent:
 * títulos com entidade HTML sem decodificar (`Can&#039;t`) e respostas que só trazem um vídeo de aviso
 * (token de debrid inválido, cache cheio) em vez de conteúdo.
 */

describe('decodeEntities', () => {
  test('decodifica entidades nomeadas que os addons usam', () => {
    expect(decodeEntities('Can&#039;t &amp; won&#039;t')).toBe("Can't & won't");
    expect(decodeEntities('&quot;Aspas&quot; &lt;tag&gt;')).toBe('"Aspas" <tag>');
  });

  test('decodifica numérica decimal e hexadecimal', () => {
    expect(decodeEntities('Pok&#233;mon')).toBe('Pokémon');
    expect(decodeEntities('Pok&#xE9;mon')).toBe('Pokémon');
    expect(decodeEntities('&#x1F3AC;')).toBe('🎬');
  });

  test('entidade desconhecida e texto normal ficam como vieram', () => {
    expect(decodeEntities('&naoexiste; 100% & 50%')).toBe('&naoexiste; 100% & 50%');
    expect(decodeEntities('Sem entidade')).toBe('Sem entidade');
  });

  test('caractere de controle não passa (vai para HTML e nome de arquivo)', () => {
    expect(decodeEntities('a&#0;b&#7;c&#x7f;d')).toBe('abcd');
    expect(decodeEntities('&#xD800;')).toBe('&#xD800;');
    expect(decodeEntities('&#x110000;')).toBe('&#x110000;');
  });
});

describe('isNoticeVideo', () => {
  test('reconhece os vídeos de aviso publicados por addons de torrent', () => {
    for (const url of [
      'https://addon.example.com/videos/failed_access_v3.mp4',
      'https://addon.example.com/videos/limits_exceeded_v2.mp4',
      'https://addon.example.com/videos/downloading_v3.mp4',
      'https://addon.example.com/static/failed_rar_v3.webm',
      'https://addon.example.com/assets/blocked_access_v2.mp3',
    ]) {
      expect(isNoticeVideo(url)).toBe(true);
    }
  });

  test('conteúdo de verdade não é confundido, mesmo com nome parecido', () => {
    for (const url of [
      'https://cdn.example.com/movies/The.Error.2019.mp4',
      'https://cdn.example.com/filmes/erro-de-calculo/erro.mp4',
      'https://addon.example.com/videos/filme.mp4',
      'https://addon.example.com/stream/abc.mp4',
    ]) {
      expect(isNoticeVideo(url)).toBe(false);
    }
  });

  test('URL inválida não quebra a normalização', () => {
    expect(isNoticeVideo('não é url')).toBe(false);
  });
});
