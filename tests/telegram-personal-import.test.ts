import { afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../src/server/config.ts';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import * as personal from '../src/server/providers/telegram/personal.ts';
import * as personalInfo from '../src/server/providers/telegram/personal-info.ts';
import { setTelegramItemThumbnail, upsertTelegramChannel, upsertTelegramItems } from '../src/server/repo/telegram.ts';
import { telegramRoutes } from '../src/server/routes/telegram.ts';
import { resetThumbRetries } from '../src/server/telegram-item-thumbs.ts';
import { photoStore } from '../src/server/telegram-photos.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);
const originalTelegramConfig = { ...config.telegram };
const originalDir = photoStore.dir;
let dir: string;
const spies: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  resetDbForTests(openDb(':memory:'));
  resetThumbRetries();
  dir = mkdtempSync(join(tmpdir(), 'nw-personal-import-'));
  photoStore.dir = () => dir;
  // Sessão de mentira: só liga o modo; todo acesso ao Telegram abaixo é substituído por espiões.
  Object.assign(config.telegram, { botToken: undefined, apiId: 1, apiHash: 'x'.repeat(32), session: 'fake' });
});

afterEach(() => {
  setSystemTime();
  for (const spy of spies.splice(0)) spy.mockRestore();
  photoStore.dir = originalDir;
  Object.assign(config.telegram, originalTelegramConfig);
  rmSync(dir, { recursive: true, force: true });
});

const fakeTelegram = (messageIds: string[], thumbsFail = false) => {
  const items = messageIds.map((messageId) => ({ messageId, caption: `v${messageId}`, durationSeconds: 60, postedAt: '2026-10-01T00:00:00.000Z' }));
  spies.push(spyOn(personal, 'fetchPersonalChannelItems').mockResolvedValue(items));
  spies.push(spyOn(personalInfo, 'fetchPersonalChannelInfo').mockResolvedValue({ title: 'Canal falso', description: null, photo: null }));
  // Só os ids pedidos voltam com miniatura: o que o Telegram não tem fica de fora, como no código real.
  const thumbs = spyOn(personalInfo, 'fetchPersonalThumbs');
  if (thumbsFail) thumbs.mockRejectedValue(new Error('rede'));
  else thumbs.mockImplementation(async (_handle, ids) => new Map(ids.map((id) => [id, PNG])));
  spies.push(thumbs);
  return thumbs;
};

describe('importar pela conta pessoal', () => {
  test('já devolve as miniaturas locais: não precisa clicar em atualizar para elas aparecerem', async () => {
    const thumbs = fakeTelegram(['10', '11']);
    const res = await telegramRoutes.request('/channels', { method: 'POST', body: JSON.stringify({ handle: 'https://t.me/c/2675951342/7', mode: 'personal' }) });
    expect(res.status).toBe(201);
    const { titleId } = (await res.json()) as { titleId: string };

    const detail = (await (await telegramRoutes.request(`/channels/${titleId}`)).json()) as { items: Array<{ messageId: string; thumbnailUrl: string | null }> };
    expect(detail.items).toHaveLength(2);
    for (const item of detail.items) expect(item.thumbnailUrl).toBe(`/api/telegram/channels/${titleId}/items/${item.messageId}/thumb`);
    expect(thumbs).toHaveBeenCalledTimes(1);
    expect(thumbs.mock.calls[0]?.[0]).toBe('c/2675951342');
    expect((await telegramRoutes.request(`/channels/${titleId}/items/10/thumb`)).status).toBe(200);
  });

  test('canal privado importado: handle c/<id>, nome vindo da conta e sem link externo', async () => {
    fakeTelegram(['10']);
    const res = await telegramRoutes.request('/channels', { method: 'POST', body: JSON.stringify({ handle: '2675951342', mode: 'personal' }) });
    expect(await res.json()).toMatchObject({ handle: 'c/2675951342', mode: 'personal', title: 'Canal falso', link: null, itemCount: 1 });
  });

  test('falha ao baixar miniaturas não derruba a importação', async () => {
    fakeTelegram(['10'], true);
    const res = await telegramRoutes.request('/channels', { method: 'POST', body: JSON.stringify({ handle: 'c/2675951342', mode: 'personal' }) });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { itemCount: number }).itemCount).toBe(1);
  });
});

/** Canal já no banco, com vídeos sem miniatura (importado antes da correção, ou o download falhou). */
const channelWithoutThumbs = (messageIds: string[]) => {
  const db = openDb(':memory:');
  resetDbForTests(db);
  const channel = upsertTelegramChannel(db, { handle: 'c/2675951342', mode: 'personal', displayName: 'Canal privado 2675951342' });
  upsertTelegramItems(db, channel.id, messageIds.map((messageId) => ({ messageId, caption: `v${messageId}`, durationSeconds: 60, postedAt: '2026-10-01T00:00:00.000Z' })));
  return { db, channel };
};

const openChannel = async (id: string) =>
  (await (await telegramRoutes.request(`/channels/${id}`)).json()) as { items: Array<{ messageId: string; thumbnailUrl: string | null }> };

describe('abrir o canal completa as miniaturas que faltam', () => {
  test('todos os vídeos chegam com miniatura local na primeira abertura', async () => {
    const thumbs = fakeTelegram([]);
    const { channel } = channelWithoutThumbs(['10', '11', '12']);
    const detail = await openChannel(channel.id);
    expect(detail.items.map((i) => i.thumbnailUrl)).toEqual(detail.items.map((i) => `/api/telegram/channels/${channel.id}/items/${i.messageId}/thumb`));
    expect(thumbs).toHaveBeenCalledTimes(1);
    expect(thumbs.mock.calls[0]?.[1]).toEqual(['10', '11', '12']);
  });

  test('só pede ao Telegram o que falta: com tudo local não há chamada', async () => {
    const thumbs = fakeTelegram([]);
    const { db, channel } = channelWithoutThumbs(['10', '11']);
    for (const id of ['10', '11']) setTelegramItemThumbnail(db, channel.id, id, `/api/telegram/channels/${channel.id}/items/${id}/thumb`);
    await openChannel(channel.id);
    expect(thumbs).not.toHaveBeenCalled();
  });

  test('se o Telegram falhar o canal abre mesmo assim (placeholder) e não é martelado a cada abertura', async () => {
    const thumbs = fakeTelegram([], true);
    const { channel } = channelWithoutThumbs(['10']);
    expect((await openChannel(channel.id)).items[0]?.thumbnailUrl).toBeNull();
    await openChannel(channel.id);
    await openChannel(channel.id);
    expect(thumbs).toHaveBeenCalledTimes(1);
  });

  test('passada a janela de espera, tenta de novo e completa', async () => {
    const thumbs = fakeTelegram([], true);
    const { channel } = channelWithoutThumbs(['10']);
    await openChannel(channel.id);
    thumbs.mockImplementation(async (_handle, ids) => new Map(ids.map((id) => [id, PNG])));
    setSystemTime(new Date(Date.now() + 2 * 60_000));
    expect((await openChannel(channel.id)).items[0]?.thumbnailUrl).toBe(`/api/telegram/channels/${channel.id}/items/10/thumb`);
    expect(thumbs).toHaveBeenCalledTimes(2);
  });
});
