import { describe, expect, test } from 'bun:test';
import { streamCardHtml } from '../../src/client/addons/stream-card.ts';
import { formatStreamBytes, parseStreamDetails } from '../../src/client/addons/stream-details.ts';
import type { AddonStreamDto } from '../../src/client/api/stremio.ts';

describe('stream-details', () => {
  test('formatStreamBytes formata KB, MB e GB', () => {
    expect(formatStreamBytes(512)).toBe('512 B');
    expect(formatStreamBytes(1024 * 500)).toBe('500 KB');
    expect(formatStreamBytes(1024 ** 3 * 1.85)).toBe('1.85 GB');
  });

  test('parseStreamDetails extrai resolução, fonte, HDR, codec, áudio, idioma, tamanho, seeds, legendas e metadados', () => {
    const stream: AddonStreamDto = {
      kind: 'torrent',
      title: 'Torrentio · 4K HDR',
      name: 'Torrentio\n4K HDR',
      description: 'Show.S01E01.2160p.BluRay.HDR10+.HEVC.10bit.Atmos.Dual.Audio-GRP.mkv\n👤 142 💾 4.5 GB ⚙️ RARBG\n🇧🇷 PT-BR',
      url: null,
      infoHash: '0123456789abcdef0123456789abcdef01234567',
      fileIdx: 2,
      filename: 'Show.S01E01.2160p.mkv',
      videoSize: Math.round(4.5 * 1024 ** 3),
      notWebReady: true,
      bingeGroup: 'torrentio|4k',
      countryWhitelist: ['BR'],
      subtitleLangs: ['por', 'eng'],
      trackerCount: 4,
    };

    const details = parseStreamDetails(stream);
    expect(details.heading).toBe('Torrentio · 4K HDR');
    expect(details.lines).toHaveLength(3);

    const labels = details.badges.map((b) => b.label);
    expect(labels).toContain('4K');
    expect(labels).toContain('P2P Torrent');
    expect(labels).toContain('BluRay');
    expect(labels).toContain('HDR10+');
    expect(labels).toContain('HEVC');
    expect(labels).toContain('10-bit');
    expect(labels).toContain('Atmos');
    expect(labels).toContain('Dual Áudio');
    expect(labels).toContain('PT-BR');
    expect(labels).toContain('4.5 GB');
    expect(labels).toContain('142 seeds');
    expect(labels).toContain('Legendas: por, eng');
    expect(labels).toContain('Pode exigir player externo');

    expect(details.meta).toContain('Arquivo: Show.S01E01.2160p.mkv (MKV)');
    expect(details.meta).toContain('Índice no pack: #2');
    expect(details.meta).toContain('4 trackers');
    expect(details.meta).toContain('Hash: 0123456789…');
    expect(details.meta).toContain('Regiões: BR');
  });

  test('streamCardHtml escapa HTML vindo do addon em título, descrição e arquivo', () => {
    const html = streamCardHtml(
      {
        kind: 'url',
        title: '<script>x</script>',
        name: '<b>Addon</b> 1080p',
        description: 'Linha <img src=x onerror=alert(1)>',
        url: 'https://cdn.example.com/video.mp4',
        infoHash: null,
        fileIdx: null,
        filename: 'ep<1>.mp4',
      },
      { buttonAttrs: 'data-play="0"' },
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;b&gt;Addon&lt;/b&gt; 1080p');
    expect(html).toContain('Servidor: cdn.example.com');
    expect(html).toContain('data-play="0"');
  });
});
