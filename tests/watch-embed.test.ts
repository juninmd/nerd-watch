import { describe, expect, test } from 'bun:test';
import { onPlayError } from '../src/client/components/player-error.ts';
import { embedFrameHtml, EMBED_ALLOW, EMBED_SANDBOX, isEmbedUrl, playerKindOf } from '../src/client/components/watch-embed.ts';

describe('playerKindOf (player do app ou iframe)', () => {
  test('item com embed https toca por iframe', () => {
    expect(playerKindOf({ embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0' })).toBe('embed');
  });

  test('sem embed, nulo ou vazio, usa o player do app', () => {
    expect(playerKindOf({})).toBe('player');
    expect(playerKindOf({ embedUrl: null })).toBe('player');
    expect(playerKindOf({ embedUrl: '' })).toBe('player');
  });

  test('embed que não é https é ignorado (nunca vira iframe)', () => {
    expect(playerKindOf({ embedUrl: 'http://evil.example/embed' })).toBe('player');
    expect(playerKindOf({ embedUrl: 'javascript:alert(1)' })).toBe('player');
    expect(playerKindOf({ embedUrl: 'não é url' })).toBe('player');
  });
});

describe('isEmbedUrl', () => {
  test('só strings https válidas', () => {
    expect(isEmbedUrl('https://video.example.org/videos/embed/x')).toBe(true);
    expect(isEmbedUrl(undefined)).toBe(false);
    expect(isEmbedUrl(42)).toBe(false);
    expect(isEmbedUrl('https://')).toBe(false);
  });
});

describe('embedFrameHtml (iframe com sandbox e permissões mínimas)', () => {
  test('tem sandbox sem navegação de topo e allow só com o necessário', () => {
    const html = embedFrameHtml('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0', 'Vídeo');
    expect(html).toContain(`sandbox="${EMBED_SANDBOX}"`);
    expect(EMBED_SANDBOX).not.toContain('allow-top-navigation');
    expect(EMBED_SANDBOX).not.toContain('allow-forms');
    expect(html).toContain(`allow="${EMBED_ALLOW}"`);
    expect(EMBED_ALLOW).not.toContain('camera');
    expect(EMBED_ALLOW).not.toContain('microphone');
    expect(html).toContain('allowfullscreen');
    expect(html).toContain('referrerpolicy="strict-origin-when-cross-origin"');
  });

  test('escapa título e URL: nada sai do atributo', () => {
    const html = embedFrameHtml('https://video.example.org/embed/x?a="b"&c=<d>', 'Título "quebrado" <img src=x>');
    expect(html).toContain('src="https://video.example.org/embed/x?a=&quot;b&quot;&amp;c=&lt;d&gt;"');
    expect(html).toContain('title="Título &quot;quebrado&quot; &lt;img src=x&gt;"');
    expect(html).not.toContain('<img');
  });
});

describe('onPlayError (erro do <video> vira embed ou mensagem)', () => {
  const run = (body: unknown, status = 409) => {
    const result: { embed?: string; message?: string } = {};
    const fakeFetch = async () => new Response(JSON.stringify(body), { status });
    return new Promise<typeof result>((resolve) => {
      onPlayError(
        'https://nerd.local/play',
        {
          onEmbed: (url) => resolve({ embed: url }),
          onMessage: (text) => resolve({ message: text }),
        },
        fakeFetch,
      );
    });
  };

  test('resposta 409 com embedUrl https troca para o embed', async () => {
    expect(await run({ error: 'só HLS', embedUrl: 'https://video.example.org/videos/embed/abc' })).toEqual({ embed: 'https://video.example.org/videos/embed/abc' });
  });

  test('embedUrl não https é recusado e vira mensagem', async () => {
    expect(await run({ error: 'erro do servidor', embedUrl: 'http://evil.example/x' })).toEqual({ message: 'erro do servidor' });
  });

  test('erro JSON sem embed mostra a mensagem do servidor', async () => {
    expect(await run({ error: 'vídeo não encontrado nesse canal' }, 404)).toEqual({ message: 'vídeo não encontrado nesse canal' });
  });

  test('falha de rede ou corpo que não é JSON mostra a mensagem padrão', async () => {
    const result = await new Promise<string>((resolve) => {
      onPlayError(
        'https://nerd.local/play',
        { onEmbed: () => resolve('embed?'), onMessage: (text) => resolve(text) },
        async () => {
          throw new TypeError('network');
        },
      );
    });
    expect(result).toBe('não foi possível reproduzir esse vídeo');
  });

  test('o pedido é um Range mínimo (nunca baixa o arquivo para ler o erro)', async () => {
    let seen: RequestInit | undefined;
    await new Promise<void>((resolve) => {
      onPlayError(
        'https://nerd.local/play',
        { onEmbed: () => resolve(), onMessage: () => resolve() },
        async (_url, init) => {
          seen = init;
          return new Response('{"error":"x"}', { status: 404 });
        },
      );
    });
    expect(new Headers(seen?.headers).get('Range')).toBe('bytes=0-0');
  });
});
