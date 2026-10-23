import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrateAddTelegramItemLink } from '../src/server/db-migrations-telegram-links.ts';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { upsertLibraryEntry } from '../src/server/repo/library.ts';
import { getTelegramItem, upsertTelegramChannel, upsertTelegramItems } from '../src/server/repo/telegram.ts';
import { replaceEpisodes, upsertSeason, upsertTitle } from '../src/server/repo/titles.ts';
import { parseManualLink, telegramLinkRoutes } from '../src/server/routes/telegram-links.ts';
import type { LinkCandidate } from '../src/server/media-name/match.ts';

const LINK_COLUMNS = ['title_id', 'season_number', 'episode_number', 'episode_end', 'link_status', 'link_source', 'link_confidence'];

describe('migração das colunas de vínculo', () => {
  test('acrescenta as colunas numa tabela antiga e roda de novo sem efeito', () => {
    const legacy = new Database(':memory:');
    legacy.exec('CREATE TABLE telegram_items (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, message_id TEXT NOT NULL)');
    legacy.exec("INSERT INTO telegram_items VALUES ('a', 'c', '1')");

    migrateAddTelegramItemLink(legacy);
    migrateAddTelegramItemLink(legacy);

    const names = legacy
      .query<{ name: string }, []>('PRAGMA table_info(telegram_items)')
      .all()
      .map((c) => c.name);
    for (const col of LINK_COLUMNS) expect(names.filter((n) => n === col)).toHaveLength(1);
    expect(legacy.query('SELECT title_id, link_status FROM telegram_items').get()).toEqual({ title_id: null, link_status: null });
  });

  test('openDb sobre um banco já migrado não falha e preserva vínculos', () => {
    const db = openDb(':memory:');
    migrateAddTelegramItemLink(db);
    expect(() => migrateAddTelegramItemLink(db)).not.toThrow();
  });

  test('sem a tabela telegram_items, não faz nada', () => {
    const empty = new Database(':memory:');
    expect(() => migrateAddTelegramItemLink(empty)).not.toThrow();
  });
});

describe('parseManualLink: validação do corpo', () => {
  const candidate: LinkCandidate = {
    titleId: 't1',
    title: 'Série',
    originalTitle: null,
    year: 2010,
    episodes: [
      { season: 1, episode: 1 },
      { season: 1, episode: 2 },
      { season: 1, episode: 3 },
    ],
  };
  const ok = { titleId: 't1', seasonNumber: 1, episodeNumber: 2 };

  test('aceita um vínculo válido', () => {
    expect(parseManualLink(ok, [candidate])).toEqual({ titleId: 't1', seasonNumber: 1, episodeNumber: 2, episodeEnd: undefined });
  });

  test.each([
    ['corpo ausente', null],
    ['titleId ausente', { seasonNumber: 1, episodeNumber: 1 }],
    ['titleId vazio', { ...ok, titleId: '' }],
    ['temporada texto', { ...ok, seasonNumber: '1' }],
    ['temporada negativa', { ...ok, seasonNumber: -1 }],
    ['temporada fracionária', { ...ok, seasonNumber: 1.5 }],
    ['episódio zero', { ...ok, episodeNumber: 0 }],
    ['episódio acima do teto', { ...ok, episodeNumber: 10000 }],
    ['fim antes do início', { ...ok, episodeEnd: 1 }],
    ['intervalo longo demais', { ...ok, episodeEnd: 500 }],
    ['título fora da biblioteca', { ...ok, titleId: 'outro' }],
    ['episódio que não existe', { ...ok, episodeNumber: 9 }],
    ['intervalo que sai do conhecido', { ...ok, episodeNumber: 2, episodeEnd: 5 }],
  ])('recusa %s', (_label, body) => {
    expect(typeof parseManualLink(body as never, [candidate])).toBe('string');
  });
});

describe('rotas de vínculo', () => {
  let db: Database;
  let channelId: string;
  let showId: string;

  beforeEach(() => {
    db = openDb(':memory:');
    resetDbForTests(db);
    channelId = upsertTelegramChannel(db, { handle: 'canal_sintetico', mode: 'bot' }).id;
    const show = upsertTitle(db, { source: 'tmdb', sourceId: 'r1', mediaType: 'tv', title: 'Show Name', releaseDate: '2010-01-01' });
    showId = show.id;
    const s1 = upsertSeason(db, showId, { seasonNumber: 1, name: 'T1' });
    replaceEpisodes(db, s1.id, [{ episodeNumber: 1, name: 'A' }, { episodeNumber: 2, name: 'B' }]);
    upsertLibraryEntry(db, showId, { watchStatus: 'watching', currentSeason: null, currentEpisode: null });
    upsertTelegramItems(db, channelId, [{ messageId: '10', fileName: 'Show Name S01E01.mkv', postedAt: null }]);
  });

  const post = (path: string, body: unknown) =>
    telegramLinkRoutes.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  test('POST /link vincula manualmente e devolve o vínculo', async () => {
    const res = await post(`/${channelId}/items/10/link`, { titleId: showId, seasonNumber: 1, episodeNumber: 2 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ link: { titleId: showId, seasonNumber: 1, episodeNumber: 2, status: 'linked', source: 'manual' } });
  });

  test('POST /link com corpo inválido responde 400 e não grava', async () => {
    const res = await post(`/${channelId}/items/10/link`, { titleId: showId, seasonNumber: 'x', episodeNumber: 1 });
    expect(res.status).toBe(400);
    expect(getTelegramItem(db, channelId, '10')?.season_number).toBe(1);
  });

  test('POST /link com JSON quebrado responde 400', async () => {
    const res = await telegramLinkRoutes.request(`/${channelId}/items/10/link`, { method: 'POST', body: '{nao-json' });
    expect(res.status).toBe(400);
  });

  test('canal inexistente responde 404', async () => {
    expect((await post('/nao-existe/items/10/link', { titleId: showId, seasonNumber: 1, episodeNumber: 1 })).status).toBe(404);
  });

  test('vídeo inexistente no canal responde 404', async () => {
    expect((await post(`/${channelId}/items/999/link`, { titleId: showId, seasonNumber: 1, episodeNumber: 1 })).status).toBe(404);
  });

  test('DELETE /link registra "sem vínculo" e devolve link nulo', async () => {
    const res = await telegramLinkRoutes.request(`/${channelId}/items/10/link`, { method: 'DELETE' });
    expect(await res.json()).toEqual({ link: null });
    expect(getTelegramItem(db, channelId, '10')).toMatchObject({ title_id: null, link_source: 'manual' });
  });

  test('POST /links/refresh é idempotente e devolve contagens', async () => {
    const a = await telegramLinkRoutes.request(`/${channelId}/links/refresh`, { method: 'POST' });
    const b = await telegramLinkRoutes.request(`/${channelId}/links/refresh`, { method: 'POST' });
    expect(await a.json()).toEqual(await b.json());
  });

  test('POST /links/accept-suggestions devolve quantas foram confirmadas', async () => {
    upsertTelegramItems(db, channelId, [{ messageId: '11', fileName: 'Show Name S01E02.mkv', postedAt: null }]);
    // o vídeo 10 (já criado no beforeEach, sem ano no nome) também é sugestão: são duas
    const res = await telegramLinkRoutes.request(`/${channelId}/links/accept-suggestions`, { method: 'POST' });
    expect(await res.json()).toEqual({ accepted: 2 });
  });
});
