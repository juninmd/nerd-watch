import { describe, expect, test } from 'bun:test';
import { canonicalLanguage, languageAccepted, normalizeLanguage } from '../src/server/providers/subtitles/languages.ts';
import { addonContentId, normalizeBase, supportsSubtitles } from '../src/server/providers/subtitles/stremio-addon.ts';

describe('normalizeLanguage', () => {
  test('traduz os códigos ISO 639-2 que o addon usa', () => {
    expect(normalizeLanguage('pob')).toEqual({ code: 'pt-BR', label: 'Português (BR)' });
    expect(normalizeLanguage('por')).toEqual({ code: 'pt', label: 'Português' });
    expect(normalizeLanguage('eng')).toEqual({ code: 'en', label: 'Inglês' });
    expect(normalizeLanguage('spa')).toEqual({ code: 'es', label: 'Espanhol' });
  });

  test('não descarta código desconhecido — devolve ele mesmo em maiúsculas', () => {
    expect(normalizeLanguage('hun')).toEqual({ code: 'hun', label: 'HUN' });
    expect(normalizeLanguage('')).toEqual({ code: '', label: '' });
  });

  test('ignora caixa e separador', () => {
    expect(normalizeLanguage('PT_BR').code).toBe('pt-BR');
    expect(normalizeLanguage('POR').code).toBe('pt');
  });
});

describe('canonicalLanguage', () => {
  test('junta as grafias do mesmo idioma', () => {
    for (const raw of ['pt-br', 'pt_br', 'pob', 'pb', 'PT-BR']) {
      expect(canonicalLanguage(raw)).toBe('pt-BR');
    }
    expect(canonicalLanguage('por')).toBe('pt');
    expect(canonicalLanguage('ENG')).toBe('en');
    expect(canonicalLanguage('hun')).toBe('hun');
  });
});

describe('languageAccepted', () => {
  test('aceita correspondência exata', () => {
    expect(languageAccepted('en', ['pt-BR', 'pt', 'en'])).toBe(true);
    expect(languageAccepted('es', ['pt-BR'])).toBe(false);
  });

  test('português é tratado como grupo: pt e pt-BR se aceitam', () => {
    // A alternativa (exigir igualdade exata) faz o usuário não achar nada sem entender por quê:
    // quem pede pt-BR e recebe por (ou vice-versa) deveria ver o resultado.
    expect(languageAccepted('pt-BR', ['pt'])).toBe(true);
    expect(languageAccepted('pt', ['pt-BR'])).toBe(true);
  });

  test('o grupo de português não vaza para outros idiomas', () => {
    expect(languageAccepted('en', ['pt'])).toBe(false);
    expect(languageAccepted('pt', ['en'])).toBe(false);
  });

  test('lista vazia não aceita nada', () => {
    expect(languageAccepted('pt-BR', [])).toBe(false);
  });
});

describe('addonContentId', () => {
  test('filme usa só o id do IMDb', () => {
    expect(addonContentId('tt0111161')).toBe('tt0111161');
  });

  test('série usa tt:temporada:episódio, que é o formato do protocolo', () => {
    expect(addonContentId('tt0944947', 1, 2)).toBe('tt0944947:1:2');
  });

  test('série sem temporada/episódio cai no id puro', () => {
    expect(addonContentId('tt0944947', null, null)).toBe('tt0944947');
    expect(addonContentId('tt0944947', 1, null)).toBe('tt0944947');
  });
});

describe('supportsSubtitles', () => {
  test('aceita o manifesto do addon oficial', () => {
    expect(
      supportsSubtitles({ id: 'org.stremio.opensubtitlesv3', name: 'OpenSubtitles v3', resources: ['subtitles'], idPrefixes: ['tt'] }),
    ).toBe(true);
  });

  test('aceita quando o recurso vem como objeto, formato da v3', () => {
    expect(supportsSubtitles({ id: 'x', name: 'x', resources: [{ name: 'subtitles', types: ['movie'] }] })).toBe(true);
  });

  test('recusa addon que não serve legendas', () => {
    expect(supportsSubtitles({ id: 'x', name: 'x', resources: ['stream', 'catalog'] })).toBe(false);
    expect(supportsSubtitles({ id: 'x', name: 'x' })).toBe(false);
  });

  test('recusa addon que só responde id que não é do IMDb', () => {
    expect(supportsSubtitles({ id: 'x', name: 'x', resources: ['subtitles'], idPrefixes: ['kitsu'] })).toBe(false);
  });
});

describe('normalizeBase', () => {
  test('tira a barra final sem mexer no resto', () => {
    expect(normalizeBase('https://a.strem.io/')).toBe('https://a.strem.io');
    expect(normalizeBase('https://a.strem.io///')).toBe('https://a.strem.io');
    expect(normalizeBase('https://a.strem.io')).toBe('https://a.strem.io');
  });
});
