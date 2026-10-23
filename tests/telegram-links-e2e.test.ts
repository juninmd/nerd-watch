import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb, resetDbForTests } from '../src/server/db.ts';
import { libraryRoutes } from '../src/server/routes/library.ts';
import { playbackRoutes } from '../src/server/routes/playback.ts';
import { telegramLinkRoutes } from '../src/server/routes/telegram-links.ts';
import { telegramRoutes } from '../src/server/routes/telegram.ts';
import { getLibraryEntryByTitle, upsertLibraryEntry } from '../src/server/repo/library.ts';
import { upsertTelegramChannel, upsertTelegramItems } from '../src/server/repo/telegram.ts';
import { replaceEpisodes, upsertSeason, upsertTitle } from '../src/server/repo/titles.ts';

/**
 * Fluxo ponta a ponta pelos handlers HTTP, com dados sintéticos. O "catálogo" é a cópia local de temporadas e
 * episódios que o refresh da TMDB grava (aqui, escrita direto no banco). Nenhuma chamada à TMDB ou ao Telegram.
 */
const NOW = Date.now();

let db: Database;
let channelId: string;
let titleId: string;

beforeEach(() => {
  db = openDb(':memory:');
  resetDbForTests(db);
  channelId = upsertTelegramChannel(db, { handle: 'canal_sintetico', mode: 'bot' }).id;
  const show = upsertTitle(db, { source: 'tmdb', sourceId: 'e2e-1', mediaType: 'tv', title: 'Série Sintética', releaseDate: '2012-05-01' });
  titleId = show.id;
  const s1 = upsertSeason(db, titleId, { seasonNumber: 1, name: 'T1' });
  replaceEpisodes(db, s1.id, [1, 2, 3].map((n) => ({ episodeNumber: n, name: `Ep ${n}`, runtime: 20 })));
  upsertLibraryEntry(db, titleId, { watchStatus: 'watching', currentSeason: 1, currentEpisode: 1 });
  upsertTelegramItems(db, channelId, [
    { messageId: '100', fileName: 'Serie Sintetica (2012) S01E02.mkv', postedAt: '2024-03-01T00:00:00Z' },
    { messageId: '101', fileName: 'Serie Sintetica S01E03.mkv', postedAt: '2024-03-02T00:00:00Z' },
  ]);
});

const putProgress = (messageId: string, seconds: number, duration: number) =>
  playbackRoutes.request(`/${channelId}:${messageId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      seconds,
      duration,
      at: NOW,
      done: false,
      meta: { title: 'Vídeo', subtitle: 'Canal', poster: null, channelId, messageId },
    }),
  });

const upNext = async () => (await (await libraryRoutes.request('/up-next?limit=5')).json()).items as Array<{ seasonNumber: number; episodeNumber: number; channelVideo: unknown }>;

describe('vídeo do canal vinculado: canal, Próximos episódios e Onde parei', () => {
  test('a lista do canal mostra o título vinculado (sugestão automática com ano e temporada = vínculo)', async () => {
    const res = await telegramRoutes.request(`/channels/${channelId}`);
    const body = (await res.json()) as { items: Array<{ messageId: string; link: { title: string; status: string; source: string } | null }> };
    const byId = Object.fromEntries(body.items.map((i) => [i.messageId, i.link]));
    expect(byId['100']).toMatchObject({ title: 'Série Sintética', status: 'linked', source: 'auto' });
    expect(byId['101']).toMatchObject({ status: 'suggested', source: 'auto' });
  });

  test('"Próximos episódios" oferece o vídeo confirmado, não a sugestão', async () => {
    const [next] = await upNext();
    expect(next).toMatchObject({ seasonNumber: 1, episodeNumber: 2, channelVideo: { messageId: '100' } });
  });

  test('assistir até o limiar avança "Onde parei", devolve o anterior e não regride numa segunda gravação', async () => {
    const first = await putProgress('100', 19.5, 20);
    const body = (await first.json()) as { applied: boolean; progress: { changed: boolean; previous: { currentEpisode: number } } };
    expect(body).toMatchObject({ applied: true, progress: { changed: true, previous: { currentEpisode: 1 } } });
    expect(getLibraryEntryByTitle(db, titleId)).toMatchObject({ current_season: 1, current_episode: 2 });
    const again = (await (await putProgress('100', 19.9, 20)).json()) as { progress: { changed: boolean } };
    expect(again.progress.changed).toBe(false);
  });

  test('abaixo do limiar não avança e a resposta continua no formato antigo', async () => {
    const body = await (await putProgress('100', 10, 20)).json();
    expect(body).toEqual({ applied: true });
  });

  test('depois de avançar, o próximo é o vídeo sugerido, que ainda não conta; aceitar as sugestões o oferece', async () => {
    await putProgress('100', 20, 20);
    expect((await upNext())[0]).toMatchObject({ seasonNumber: 1, episodeNumber: 3, channelVideo: null });

    const acc = await telegramLinkRoutes.request(`/${channelId}/links/accept-suggestions`, { method: 'POST' });
    expect(await acc.json()).toEqual({ accepted: 1 });
    expect((await upNext())[0]).toMatchObject({ episodeNumber: 3, channelVideo: { messageId: '101' } });
  });
});
