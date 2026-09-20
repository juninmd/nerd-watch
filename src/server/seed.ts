/**
 * Dados de demonstração — catálogo 100% fictício (não copia metadados reais da
 * TMDB), só para mostrar a interface sem exigir `TMDB_API_KEY`. Rode com
 * `bun run seed`. Idempotente: reexecutar não duplica linhas.
 */
import { getDb } from './db.ts';
import { upsertLibraryEntry } from './repo/library.ts';
import { replaceEpisodes, upsertSeason, upsertTitle } from './repo/titles.ts';
import { todayIso } from './date.ts';

const addDays = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const db = await getDb();

const horizonte = upsertTitle(db, {
  source: 'tmdb',
  sourceId: 'demo-horizonte-vermelho',
  mediaType: 'tv',
  title: 'Horizonte Vermelho',
  overview:
    'Uma tripulação isolada numa estação orbital descobre um sinal que reescreve tudo o que sabiam sobre a colonização de Marte.',
  releaseDate: addDays(-400),
  voteAverage: 8.4,
});
const season1 = upsertSeason(db, horizonte.id, { seasonNumber: 1, name: 'Temporada 1', overview: 'A chegada.', airDate: addDays(-400) });
replaceEpisodes(
  db,
  season1.id,
  Array.from({ length: 8 }, (_, i) => ({
    episodeNumber: i + 1,
    name: `Sinal ${i + 1}`,
    overview: `Um novo fragmento do sinal é decifrado, e a tripulação percebe que não está sozinha na estação. Episódio ${i + 1} da temporada 1.`,
    airDate: addDays(-400 + i * 7),
    runtime: 45,
  })),
);
const season2 = upsertSeason(db, horizonte.id, { seasonNumber: 2, name: 'Temporada 2', overview: 'A resposta.', airDate: addDays(-30) });
replaceEpisodes(
  db,
  season2.id,
  Array.from({ length: 8 }, (_, i) => ({
    episodeNumber: i + 1,
    name: `Resposta ${i + 1}`,
    overview: `Com o sinal decifrado, a tripulação precisa decidir se responde — e o que isso custa. Episódio ${i + 1} da temporada 2.`,
    airDate: addDays(-30 + i * 7),
    runtime: 48,
  })),
);
upsertLibraryEntry(db, horizonte.id, { watchStatus: 'watching', currentSeason: 2, currentEpisode: 4, rating: 9 });

const farol = upsertTitle(db, {
  source: 'tmdb',
  sourceId: 'demo-ultimo-farol',
  mediaType: 'tv',
  title: 'O Último Farol',
  overview: 'Numa vila costeira, a chegada de uma forasteira reabre um mistério que a cidade preferia esquecer.',
  releaseDate: addDays(-900),
  voteAverage: 9.1,
});
const farolSeason = upsertSeason(db, farol.id, { seasonNumber: 1, name: 'Temporada 1', overview: 'A chegada', airDate: addDays(-900) });
replaceEpisodes(
  db,
  farolSeason.id,
  Array.from({ length: 6 }, (_, i) => ({
    episodeNumber: i + 1,
    name: `Capítulo ${i + 1}`,
    overview: `A forasteira se aproxima da verdade sobre o farol abandonado. Episódio ${i + 1}.`,
    airDate: addDays(-900 + i * 7),
    runtime: 50,
  })),
);
upsertLibraryEntry(db, farol.id, { watchStatus: 'watched', currentSeason: 1, currentEpisode: 6, rating: 10, notes: 'Melhor final do ano.' });

const mare = upsertTitle(db, {
  source: 'tmdb',
  sourceId: 'demo-mare-alta',
  mediaType: 'tv',
  title: 'Maré Alta',
  overview: 'Três irmãs dividem um restaurante de família e os segredos que vieram com ele — novela em capítulos diários.',
  releaseDate: addDays(-60),
  voteAverage: 7.8,
});
const mareSeason = upsertSeason(db, mare.id, { seasonNumber: 1, name: 'Temporada 1', overview: '', airDate: addDays(-60) });
replaceEpisodes(
  db,
  mareSeason.id,
  Array.from({ length: 10 }, (_, i) => ({
    episodeNumber: i + 1,
    name: `Capítulo ${i + 1}`,
    overview: `A tensão entre as irmãs cresce enquanto o restaurante enfrenta uma nova ameaça. Capítulo ${i + 1}.`,
    airDate: addDays(-60 + i * 7),
    runtime: 30,
  })),
);
upsertLibraryEntry(db, mare.id, { watchStatus: 'watching', currentSeason: 1, currentEpisode: 8, rating: 7 });

const sinfonia = upsertTitle(db, {
  source: 'tmdb',
  sourceId: 'demo-sinfonia-meia-noite',
  mediaType: 'movie',
  title: 'Sinfonia da Meia-Noite',
  overview: 'Um maestro em decadência aceita reger uma última apresentação que pode redimir — ou encerrar — sua carreira.',
  releaseDate: addDays(-10),
  voteAverage: 8.0,
});
upsertLibraryEntry(db, sinfonia.id, { watchStatus: 'want' });

const codice = upsertTitle(db, {
  source: 'tmdb',
  sourceId: 'demo-codice-perdido',
  mediaType: 'movie',
  title: 'Códice Perdido',
  overview: 'Uma equipe de arqueólogos corre contra o tempo para decifrar um manuscrito antes que ele seja vendido no mercado negro.',
  releaseDate: addDays(-200),
  voteAverage: 5.2,
});
upsertLibraryEntry(db, codice.id, { watchStatus: 'dropped', notes: 'Ritmo muito lento nos primeiros 30 min.' });

const constelacao = upsertTitle(db, {
  source: 'tmdb',
  sourceId: 'demo-constelacao-zero',
  mediaType: 'movie',
  title: 'Constelação Zero',
  overview: 'A tripulação de Horizonte Vermelho ganha um spin-off: a origem da primeira colônia fora do sistema solar.',
  releaseDate: addDays(12),
  voteAverage: 0,
});
upsertLibraryEntry(db, constelacao.id, { watchStatus: 'want' });

console.log(`seed concluído em ${todayIso()} — 6 títulos, biblioteca populada.`);
