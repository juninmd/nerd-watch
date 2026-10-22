import { describe, expect, test } from 'bun:test';
import { extractChannelId } from '../src/server/providers/youtube/api.ts';
import { parseYoutubeHandle, parseYoutubeInput, youtubeEmbedUrl, youtubeLink } from '../src/server/providers/youtube/ids.ts';

const CH = 'UCBR8-60-B28hp2BmDPdntcQ';
const PL = 'PLbpi6ZahtOH6Ar_3GPy3workzyTkvbQdL';

describe('parseYoutubeInput', () => {
  test.each([
    [CH, { kind: 'channel', id: CH }],
    [PL, { kind: 'playlist', id: PL }],
    ['@YouTube', { kind: 'handle', handle: '@YouTube' }],
    [`https://www.youtube.com/channel/${CH}`, { kind: 'channel', id: CH }],
    [`https://youtube.com/channel/${CH}/`, { kind: 'channel', id: CH }],
    ['https://www.youtube.com/@YouTube', { kind: 'handle', handle: '@YouTube' }],
    [`https://www.youtube.com/playlist?list=${PL}`, { kind: 'playlist', id: PL }],
    [`https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${PL}`, { kind: 'playlist', id: PL }],
  ])('aceita %s', (input, expected) => {
    expect(parseYoutubeInput(input)).toEqual(expected as never);
  });

  test.each([
    `http://www.youtube.com/channel/${CH}`, // sem TLS
    `https://evil.example/channel/${CH}`,
    'https://www.youtube.com.evil.example/@YouTube',
    'https://www.youtube.com:8443/@YouTube',
    'https://user:pw@www.youtube.com/@YouTube',
    'https://www.youtube.com/channel/UCshort',
    '@a', // handle curto demais
    '@bad handle',
    'UCshort',
    'javascript:alert(1)',
    'https://www.youtube.com/@YouTube/../../etc',
    '',
  ])('recusa %s', (input) => {
    expect(parseYoutubeInput(input)).toBeNull();
  });
});

describe('handle guardado e link', () => {
  test('ida e volta do handle e link oficial por tipo', () => {
    expect(parseYoutubeHandle(`youtube:channel:${CH}`)).toEqual({ kind: 'channel', id: CH });
    expect(parseYoutubeHandle(`youtube:playlist:${PL}`)).toEqual({ kind: 'playlist', id: PL });
    expect(youtubeLink('channel', CH)).toBe(`https://www.youtube.com/channel/${CH}`);
    expect(youtubeLink('playlist', PL)).toBe(`https://www.youtube.com/playlist?list=${PL}`);
  });

  test('handle adulterado é recusado (tipo errado ou ID malformado)', () => {
    expect(parseYoutubeHandle(`youtube:channel:${PL}`)).toBeNull();
    expect(parseYoutubeHandle('youtube:channel:../../x')).toBeNull();
    expect(parseYoutubeHandle('peertube:canal@framatube.org')).toBeNull();
  });
});

describe('youtubeEmbedUrl', () => {
  test('embed sem cookies com o ID de 11 caracteres', () => {
    expect(youtubeEmbedUrl('dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0');
  });

  test.each(['', 'curto', 'dQw4w9WgXc"Q', 'dQw4w9WgXcQ/../x', 'dQw4w9WgXcQ?x=1', 'dQw4w9WgXcQdQw'])('ID malformado %s nunca vira URL', (id) => {
    expect(youtubeEmbedUrl(id)).toBeNull();
  });
});

describe('extractChannelId (página @handle, fixture sintética mínima)', () => {
  const ID = 'UCAAAAAAAAAAAAAAAAAAAAAA';

  test('usa o link canônico primeiro', () => {
    expect(extractChannelId(`<head><link rel="canonical" href="https://www.youtube.com/channel/${ID}"></head>`)).toBe(ID);
  });

  test('cai para externalId quando não há canônico', () => {
    expect(extractChannelId(`{"header":{"externalId":"${ID}"}}`)).toBe(ID);
  });

  test('cai para channelId como última opção', () => {
    expect(extractChannelId(`{"channelId":"${ID}"}`)).toBe(ID);
  });

  test('HTML que mudou de formato devolve null (o chamador dá mensagem clara)', () => {
    expect(extractChannelId('<html><body>layout novo</body></html>')).toBeNull();
    expect(extractChannelId(`<link rel="canonical" href="https://evil.example/channel/${ID}">`)).toBeNull();
  });
});
