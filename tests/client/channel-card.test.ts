import { describe, expect, test } from 'bun:test';
import { videoCardHtml } from '../../src/client/channels/channel-card.ts';
import { uploadDate } from '../../src/client/channels/telegram-items.ts';

const item = { messageId: '5', caption: 'Ep 1', fileName: 'ep<1>.mkv', postedAt: '2026-11-12T15:00:00Z', thumbnailUrl: null, durationSeconds: 90 } as never;

describe('uploadDate', () => {
  test('formata em pt-BR e devolve o ISO; inválida ou ausente vira null', () => {
    expect(uploadDate('2026-11-12T15:00:00Z')?.label).toMatch(/12.*nov.*2026/);
    expect(uploadDate('lixo')).toBeNull();
    expect(uploadDate(null)).toBeNull();
  });
});

describe('videoCardHtml', () => {
  test('mostra nome do arquivo (escapado) e data de upload no card', () => {
    const html = videoCardHtml(item, null, false);
    expect(html).toContain('ep&lt;1&gt;.mkv');
    expect(html).not.toContain('ep<1>');
    expect(html).toContain('<time datetime="2026-11-12T15:00:00.000Z">');
  });

  test('sem arquivo nem data não renderiza linhas vazias', () => {
    const html = videoCardHtml({ ...(item as object), fileName: null, postedAt: null } as never, null, false);
    expect(html).not.toContain('tg-fact');
  });
});
