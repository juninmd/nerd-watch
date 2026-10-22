import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { registerSource, restoreRegistry, snapshotRegistry } from '../src/server/providers/sources/registry.ts';
import type { FileSource } from '../src/server/providers/sources/types.ts';
import { upsertTelegramChannel, upsertTelegramItems } from '../src/server/repo/telegram.ts';
import { telegramRoutes } from '../src/server/routes/telegram.ts';

const snapshot = snapshotRegistry();
const EMBEDDED = 'AAAAAAAAAAA';

/** Fonte falsa só de embed: o contrato `embedUrl(fileRef)` é o que a rota de detalhe precisa repassar. */
const embedOnly: FileSource = {
  mode: 'youtube',
  link: () => null,
  resolve: async () => ({ handle: 'fake:1', name: 'Falso' }),
  list: async () => [],
  play: async () => new Response('', { status: 501 }),
  embedUrl: (fileRef) => (fileRef === EMBEDDED ? `https://www.youtube-nocookie.com/embed/${fileRef}?rel=0` : null),
};

const plain: FileSource = { ...embedOnly, mode: 'drive', embedUrl: undefined };

beforeAll(() => {
  registerSource(embedOnly);
  registerSource(plain);
});

afterAll(() => restoreRegistry(snapshot));

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
});

const detail = async (id: string) => (await (await telegramRoutes.request(`/channels/${id}`)).json()) as { items: Array<Record<string, unknown>> };

describe('GET /api/telegram/channels/:id: embedUrl por item', () => {
  test('fonte com embed entrega embedUrl só para o item que tem embed', async () => {
    const db = openDb(':memory:');
    resetDbForTests(db);
    const channel = upsertTelegramChannel(db, { handle: 'fake:canal', mode: 'youtube', displayName: 'Canal' });
    upsertTelegramItems(db, channel.id, [
      { messageId: '1', caption: 'sem embed', fileRef: 'BBBBBBBBBBB' },
      { messageId: '2', caption: 'com embed', fileRef: EMBEDDED },
    ]);
    const { items } = await detail(channel.id);
    const byCaption = Object.fromEntries(items.map((i) => [i.caption, i]));
    expect(byCaption['com embed']?.embedUrl).toBe(`https://www.youtube-nocookie.com/embed/${EMBEDDED}?rel=0`);
    expect('embedUrl' in (byCaption['sem embed'] ?? {})).toBe(false);
  });

  test('fonte sem embedUrl não expõe o campo em nenhum item', async () => {
    const db = openDb(':memory:');
    resetDbForTests(db);
    const channel = upsertTelegramChannel(db, { handle: 'fake:drive', mode: 'drive', displayName: 'Pasta' });
    upsertTelegramItems(db, channel.id, [{ messageId: '1', caption: 'arquivo', fileRef: EMBEDDED }]);
    const { items } = await detail(channel.id);
    expect('embedUrl' in (items[0] ?? {})).toBe(false);
  });
});
