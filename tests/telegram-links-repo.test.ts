import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/server/db.ts';
import { getLibraryEntryByTitle, upsertLibraryEntry } from '../src/server/repo/library.ts';
import { advanceLinkedProgress, isAheadOf, isPlayed, PLAYED_RATIO } from '../src/server/repo/telegram-link-progress.ts';
import { acceptChannelSuggestions, refreshChannelLinks, setItemLink } from '../src/server/repo/telegram-links.ts';
import { getTelegramItem, upsertTelegramChannel, upsertTelegramItems } from '../src/server/repo/telegram.ts';
import { replaceEpisodes, upsertSeason, upsertTitle } from '../src/server/repo/titles.ts';
import { listUpNext } from '../src/server/repo/up-next.ts';

/** Dados sintéticos: nada aqui vem de canal ou de catálogo real. */
let db: Database;
let channelId: string;
let showId: string;

const seedShow = (sourceId: string, name: string, year: string | null, seasons: Record<number, number>) => {
  const t = upsertTitle(db, { source: 'tmdb', sourceId, mediaType: 'tv', title: name, releaseDate: year ? `${year}-01-01` : undefined });
  for (const [num, count] of Object.entries(seasons)) {
    const season = upsertSeason(db, t.id, { seasonNumber: Number(num), name: `T${num}` });
    replaceEpisodes(db, season.id, Array.from({ length: count }, (_, i) => ({ episodeNumber: i + 1, name: `Ep ${i + 1}` })));
  }
  return t;
};

const listRows = () =>
  db.query('SELECT message_id, title_id, season_number, episode_number, link_status, link_source FROM telegram_items ORDER BY message_id').all();

const item = (messageId: string, fileName: string | null, caption: string | null = null) => ({ messageId, fileName, caption, postedAt: null });

beforeEach(() => {
  db = openDb(':memory:');
  channelId = upsertTelegramChannel(db, { handle: 'canal_sintetico', mode: 'bot' }).id;
  const show = seedShow('s1', 'Show Name', '2010', { 1: 3, 2: 2 });
  showId = show.id;
  upsertLibraryEntry(db, showId, { watchStatus: 'watching', currentSeason: null, currentEpisode: null });
});

describe('importação e vínculo automático', () => {
  test('vídeo com ano e temporada no nome vincula ao importar', () => {
    upsertTelegramItems(db, channelId, [item('10', 'Show Name (2010) S01E02.mkv')]);
    const row = getTelegramItem(db, channelId, '10');
    expect(row).toMatchObject({ title_id: showId, season_number: 1, episode_number: 2, link_status: 'linked', link_source: 'auto' });
  });

  test('sem ano no nome: vira sugestão, não vínculo', () => {
    upsertTelegramItems(db, channelId, [item('11', 'Show Name S01E02.mkv')]);
    expect(getTelegramItem(db, channelId, '11')).toMatchObject({ link_status: 'suggested', link_source: 'auto' });
  });

  test('legenda entra quando o nome do arquivo não casa', () => {
    upsertTelegramItems(db, channelId, [item('12', 'video.mkv', 'Show Name (2010) S02E01')]);
    expect(getTelegramItem(db, channelId, '12')).toMatchObject({ season_number: 2, episode_number: 1, link_status: 'linked' });
  });

  test('refazer o vínculo automático é idempotente', () => {
    upsertTelegramItems(db, channelId, [item('10', 'Show Name (2010) S01E02.mkv'), item('11', 'Show Name S01E03.mkv')]);
    const before = listRows();
    const counts1 = refreshChannelLinks(db, channelId);
    const counts2 = refreshChannelLinks(db, channelId);
    expect(listRows()).toEqual(before);
    expect(counts2).toEqual(counts1);
  });

  test('título ambíguo (dois iguais) fica sem vínculo', () => {
    const twin = seedShow('s2', 'Show Name', '2010', { 1: 3 });
    upsertLibraryEntry(db, twin.id, { watchStatus: 'watching', currentSeason: null, currentEpisode: null });
    upsertTelegramItems(db, channelId, [item('13', 'Show Name (2010) S01E01.mkv')]);
    expect(getTelegramItem(db, channelId, '13')).toMatchObject({ title_id: null, link_status: null });
  });

  test('a importação de páginas antigas não mexe nas decisões do usuário', () => {
    upsertTelegramItems(db, channelId, [item('20', 'Show Name S01E01.mkv')]);
    setItemLink(db, channelId, '20', { titleId: showId, seasonNumber: 2, episodeNumber: 1 });
    upsertTelegramItems(db, channelId, [item('20', 'Show Name S01E01.mkv')]);
    expect(getTelegramItem(db, channelId, '20')).toMatchObject({ season_number: 2, link_source: 'manual' });
  });
});

describe('decisão do usuário', () => {
  test('vínculo manual sobrevive ao recálculo automático', () => {
    upsertTelegramItems(db, channelId, [item('30', 'Show Name S01E01.mkv')]);
    setItemLink(db, channelId, '30', { titleId: showId, seasonNumber: 1, episodeNumber: 3 });
    refreshChannelLinks(db, channelId);
    expect(getTelegramItem(db, channelId, '30')).toMatchObject({ season_number: 1, episode_number: 3, link_status: 'linked', link_source: 'manual' });
  });

  test('"sem vínculo" manual não volta a ser sugerido', () => {
    upsertTelegramItems(db, channelId, [item('31', 'Show Name S01E01.mkv')]);
    setItemLink(db, channelId, '31', null);
    refreshChannelLinks(db, channelId);
    expect(getTelegramItem(db, channelId, '31')).toMatchObject({ title_id: null, link_status: null, link_source: 'manual' });
  });

  test('aceitar sugestões confirma só as sugeridas', () => {
    upsertTelegramItems(db, channelId, [item('40', 'Show Name S01E01.mkv'), item('41', 'Show Name (2010) S01E02.mkv')]);
    expect(acceptChannelSuggestions(db, channelId)).toBe(1);
    expect(getTelegramItem(db, channelId, '40')).toMatchObject({ link_status: 'linked', link_source: 'manual' });
    expect(getTelegramItem(db, channelId, '41')).toMatchObject({ link_status: 'linked', link_source: 'auto' });
  });

  test('vínculo do título que sai do banco é limpo (ON DELETE SET NULL)', () => {
    upsertTelegramItems(db, channelId, [item('50', 'Show Name (2010) S01E01.mkv')]);
    db.query('DELETE FROM titles WHERE id = ?').run(showId);
    expect(getTelegramItem(db, channelId, '50')).toMatchObject({ title_id: null });
  });
});

describe('progresso pelo vídeo vinculado', () => {
  const link = (messageId: string, season: number, episode: number, episodeEnd?: number) =>
    setItemLink(db, channelId, messageId, { titleId: showId, seasonNumber: season, episodeNumber: episode, episodeEnd });

  beforeEach(() => {
    upsertTelegramItems(db, channelId, [item('60', 'x.mkv'), item('61', 'y.mkv')]);
  });

  test('sem marcador: o vídeo vinculado avança "Onde parei" e devolve o estado anterior (para desfazer)', () => {
    link('60', 1, 2);
    const r = advanceLinkedProgress(db, channelId, '60');
    expect(r).toMatchObject({ titleId: showId, seasonNumber: 1, episodeNumber: 2, changed: true, previous: { currentSeason: null } });
    expect(getLibraryEntryByTitle(db, showId)).toMatchObject({ current_season: 1, current_episode: 2 });
  });

  test('nunca regride: episódio anterior ao marcador não muda nada', () => {
    upsertLibraryEntry(db, showId, { watchStatus: 'watching', currentSeason: 1, currentEpisode: 3 });
    link('60', 1, 2);
    expect(advanceLinkedProgress(db, channelId, '60')).toMatchObject({ changed: false });
    expect(getLibraryEntryByTitle(db, showId)).toMatchObject({ current_season: 1, current_episode: 3 });
  });

  test('mesmo episódio do marcador também não regrava', () => {
    upsertLibraryEntry(db, showId, { watchStatus: 'watching', currentSeason: 1, currentEpisode: 2 });
    link('60', 1, 2);
    expect(advanceLinkedProgress(db, channelId, '60')).toMatchObject({ changed: false });
  });

  test('título removido da lista: não avança e não recria a entrada', () => {
    link('60', 1, 2);
    db.query('DELETE FROM library_entries WHERE title_id = ?').run(showId);
    expect(advanceLinkedProgress(db, channelId, '60')).toBeNull();
    expect(getLibraryEntryByTitle(db, showId)).toBeNull();
  });

  test('intervalo marca até o último episódio do intervalo', () => {
    link('60', 1, 1, 3);
    advanceLinkedProgress(db, channelId, '60');
    expect(getLibraryEntryByTitle(db, showId)).toMatchObject({ current_season: 1, current_episode: 3 });
  });

  test('vídeo sem vínculo confirmado não faz nada', () => {
    upsertTelegramItems(db, channelId, [item('62', 'Show Name S01E01.mkv')]); // sugestão
    expect(advanceLinkedProgress(db, channelId, '62')).toBeNull();
    expect(advanceLinkedProgress(db, channelId, 'nao-existe')).toBeNull();
  });

  test('limiar de assistido é 95% da duração ou o flag done', () => {
    expect(PLAYED_RATIO).toBe(0.95);
    expect(isPlayed(94, 100, false)).toBe(false);
    expect(isPlayed(95, 100, false)).toBe(true);
    expect(isPlayed(10, null, true)).toBe(true);
    expect(isPlayed(10, null, false)).toBe(false);
  });

  test('isAheadOf respeita especiais (temporada 0) como trilha própria', () => {
    expect(isAheadOf({ season: 1, episode: 5 }, 2, 1)).toBe(true);
    expect(isAheadOf({ season: 1, episode: 5 }, 1, 5)).toBe(false);
    expect(isAheadOf({ season: 0, episode: 2 }, 1, 1)).toBe(false);
    expect(isAheadOf({ season: null, episode: null }, 1, 1)).toBe(true);
  });
});

describe('Próximos episódios com vídeo vinculado', () => {
  test('oferece o vídeo do canal para o próximo episódio, se confirmado', () => {
    upsertLibraryEntry(db, showId, { watchStatus: 'watching', currentSeason: 1, currentEpisode: 1 });
    upsertTelegramItems(db, channelId, [item('70', 'Show Name (2010) S01E02.mkv')]);
    expect(listUpNext(db, 5)[0]?.channelVideo).toEqual({ channelId, messageId: '70' });
  });

  test('sugestão não conta como alvo de "continuar"', () => {
    upsertLibraryEntry(db, showId, { watchStatus: 'watching', currentSeason: 1, currentEpisode: 1 });
    upsertTelegramItems(db, channelId, [item('71', 'Show Name S01E02.mkv')]);
    expect(listUpNext(db, 5)[0]?.channelVideo).toBeNull();
  });

  test('entre duplicatas, vale o primeiro postado', () => {
    upsertLibraryEntry(db, showId, { watchStatus: 'watching', currentSeason: 1, currentEpisode: 1 });
    const other = upsertTelegramChannel(db, { handle: 'outro_canal', mode: 'bot' }).id;
    upsertTelegramItems(db, other, [{ messageId: '5', fileName: 'Show Name (2010) S01E02.mkv', postedAt: '2024-02-01T00:00:00Z' }]);
    upsertTelegramItems(db, channelId, [{ messageId: '9', fileName: 'Show Name (2010) S01E02.mkv', postedAt: '2024-01-01T00:00:00Z' }]);
    expect(listUpNext(db, 5)[0]?.channelVideo).toEqual({ channelId, messageId: '9' });
  });
});
