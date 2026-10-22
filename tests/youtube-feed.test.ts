import { describe, expect, test } from 'bun:test';
import { parseFeed } from '../src/server/providers/youtube/feed.ts';

/** Feed Atom sintético e mínimo (IDs e títulos inventados), no formato que o YouTube entrega. */
const entry = (videoId: string, title: string, published = '2026-10-19T12:00:00+00:00') => `
 <entry>
  <id>yt:video:${videoId}</id>
  <yt:videoId>${videoId}</yt:videoId>
  <title>${title}</title>
  <published>${published}</published>
 </entry>`;

const feed = (title: string, ...entries: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">\n <title>${title}</title>${entries.join('')}\n</feed>`;

describe('parseFeed (feed do YouTube)', () => {
  test('lê o título do canal e os vídeos com id, título e data', () => {
    const result = parseFeed(feed('Canal Sintético', entry('AAAAAAAAAAA', 'Primeiro'), entry('BBBBBBBBBBB', 'Segundo', '2026-10-18T08:30:00+00:00')));
    expect(result).toEqual({
      title: 'Canal Sintético',
      videos: [
        { videoId: 'AAAAAAAAAAA', title: 'Primeiro', publishedAt: '2026-10-19T12:00:00+00:00' },
        { videoId: 'BBBBBBBBBBB', title: 'Segundo', publishedAt: '2026-10-18T08:30:00+00:00' },
      ],
    });
  });

  test('decodifica entidades numa passada só (&amp;lt; vira &lt;, nunca <)', () => {
    const result = parseFeed(feed('A &amp; B', entry('AAAAAAAAAAA', 'Tom &amp;lt;3 &#39;ok&#39; &#x1F600; &#8217;')));
    expect(result?.title).toBe('A & B');
    expect(result?.videos[0]?.title).toBe("Tom &lt;3 'ok' 😀 ’");
  });

  test('entidade numérica fora do intervalo é descartada em vez de estourar', () => {
    const result = parseFeed(feed('X', entry('AAAAAAAAAAA', 'antes &#99999999999; depois')));
    expect(result?.videos[0]?.title).toBe('antes  depois');
  });

  test('CDATA no título é lido como texto', () => {
    const result = parseFeed(feed('X', entry('AAAAAAAAAAA', '<![CDATA[Vídeo <b>cru</b>]]>')));
    expect(result?.videos[0]?.title).toBe('Vídeo <b>cru</b>');
  });

  test('recusa DOCTYPE e ENTITY (XXE e explosão de entidades) sem tentar ler nada', () => {
    expect(parseFeed('<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///etc/passwd">]><feed><entry><yt:videoId>&x;</yt:videoId></entry></feed>')).toBeNull();
    expect(parseFeed('<!DOCTYPE lolz [<!ENTITY lol "lol">]><feed>&lol;</feed>')).toBeNull();
    expect(parseFeed('<feed><!entity x "y"></feed>')).toBeNull();
  });

  test('resposta que não é um feed (HTML de erro) devolve null', () => {
    expect(parseFeed('<html><title>Error 404</title></html>')).toBeNull();
    expect(parseFeed('')).toBeNull();
  });

  test('entrada com id inválido é ignorada, sem derrubar as outras', () => {
    const result = parseFeed(feed('X', entry('../../etc/x', 'ruim'), entry('CCCCCCCCCCC', 'boa')));
    expect(result?.videos.map((v) => v.videoId)).toEqual(['CCCCCCCCCCC']);
  });

  test('entry truncado (sem fechamento) não gera vídeo fantasma', () => {
    const truncated = feed('X', entry('AAAAAAAAAAA', 'ok')).replace('</entry>', '');
    expect(parseFeed(truncated)?.videos).toEqual([]);
  });

  test('data inválida vira null, não NaN', () => {
    const result = parseFeed(feed('X', entry('AAAAAAAAAAA', 'x', 'não é data')));
    expect(result?.videos[0]?.publishedAt).toBeNull();
  });

  test('limita a 50 entradas e o título a 300 caracteres', () => {
    const many = Array.from({ length: 60 }, (_, i) => entry(`V${String(i).padStart(10, '0')}`, 't'));
    expect(parseFeed(feed('X', ...many))?.videos).toHaveLength(50);
    expect(parseFeed(feed('X', entry('AAAAAAAAAAA', 'z'.repeat(1000))))?.videos[0]?.title).toHaveLength(300);
  });

  test('feed sem vídeos é válido e vazio', () => {
    expect(parseFeed(feed('Canal vazio'))).toEqual({ title: 'Canal vazio', videos: [] });
  });
});
