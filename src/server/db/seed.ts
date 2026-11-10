/**
 * Dados de demonstração — catálogo 100% fictício (não copia metadados reais da
 * TMDB), só para mostrar a interface sem exigir `TMDB_API_KEY`. Rode com
 * `bun run seed`. Idempotente: reexecutar não duplica linhas.
 */
import { getDb } from './database.ts';
import { upsertLibraryEntry } from '../repo/library.ts';
import { replaceEpisodes, upsertSeason, upsertTitle } from '../repo/titles.ts';
import { todayIso } from '../lib/date.ts';

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

// ---- Acervo extra: dá corpo à biblioteca e às estatísticas (gêneros, duração, notas e histórico ao longo do ano). ----

interface DemoTitle {
  slug: string;
  title: string;
  mediaType: 'movie' | 'tv';
  genres: string[];
  runtime: number;
  status: 'want' | 'watching' | 'watched' | 'dropped';
  rating?: number;
  /** Há quantos dias foi concluído (só para `watched`): espalha as conclusões pelo ano. */
  finishedDaysAgo?: number;
  rewatchedDaysAgo?: number;
}

const DEMO: DemoTitle[] = [
  { slug: 'atlas-de-areia', title: 'Atlas de Areia', mediaType: 'movie', genres: ['Aventura', 'Drama'], runtime: 128, status: 'watched', rating: 9, finishedDaysAgo: 291 },
  { slug: 'o-relojoeiro', title: 'O Relojoeiro de Praga', mediaType: 'movie', genres: ['Suspense', 'Mistério'], runtime: 112, status: 'watched', rating: 8, finishedDaysAgo: 268 },
  { slug: 'verao-em-orbita', title: 'Verão em Órbita', mediaType: 'movie', genres: ['Ficção científica', 'Comédia'], runtime: 97, status: 'watched', rating: 7, finishedDaysAgo: 262 },
  { slug: 'a-ultima-estacao', title: 'A Última Estação', mediaType: 'movie', genres: ['Drama'], runtime: 134, status: 'watched', rating: 10, finishedDaysAgo: 230, rewatchedDaysAgo: 41 },
  { slug: 'ecos-do-vale', title: 'Ecos do Vale', mediaType: 'tv', genres: ['Mistério', 'Drama'], runtime: 48, status: 'watched', rating: 8, finishedDaysAgo: 214 },
  { slug: 'neon-e-chuva', title: 'Neon e Chuva', mediaType: 'movie', genres: ['Ficção científica', 'Suspense'], runtime: 118, status: 'watched', rating: 9, finishedDaysAgo: 187 },
  { slug: 'a-receita', title: 'A Receita da Vó Zélia', mediaType: 'movie', genres: ['Comédia'], runtime: 92, status: 'watched', rating: 6, finishedDaysAgo: 171 },
  { slug: 'cartas-para-lia', title: 'Cartas para Lia', mediaType: 'movie', genres: ['Romance', 'Drama'], runtime: 105, status: 'watched', rating: 8, finishedDaysAgo: 164 },
  { slug: 'guardioes-do-recife', title: 'Guardiões do Recife', mediaType: 'tv', genres: ['Animação', 'Aventura'], runtime: 24, status: 'watched', rating: 9, finishedDaysAgo: 133 },
  { slug: 'o-sobrado', title: 'O Sobrado', mediaType: 'movie', genres: ['Terror', 'Suspense'], runtime: 101, status: 'watched', rating: 7, finishedDaysAgo: 98 },
  { slug: 'linha-de-fundo', title: 'Linha de Fundo', mediaType: 'movie', genres: ['Documentário'], runtime: 88, status: 'watched', rating: 8, finishedDaysAgo: 96 },
  { slug: 'duas-luas', title: 'Duas Luas', mediaType: 'movie', genres: ['Ficção científica', 'Drama'], runtime: 141, status: 'watched', rating: 9, finishedDaysAgo: 62, rewatchedDaysAgo: 9 },
  { slug: 'a-travessia', title: 'A Travessia', mediaType: 'movie', genres: ['Aventura', 'Drama'], runtime: 124, status: 'watched', rating: 8, finishedDaysAgo: 37 },
  { slug: 'feira-livre', title: 'Feira Livre', mediaType: 'tv', genres: ['Comédia'], runtime: 26, status: 'watched', rating: 7, finishedDaysAgo: 20 },
  { slug: 'o-mapa-invertido', title: 'O Mapa Invertido', mediaType: 'movie', genres: ['Mistério', 'Aventura'], runtime: 116, status: 'watched', rating: 9, finishedDaysAgo: 6 },
  { slug: 'arquivo-morto', title: 'Arquivo Morto', mediaType: 'tv', genres: ['Suspense', 'Drama'], runtime: 52, status: 'watching', rating: 8 },
  { slug: 'jardim-suspenso', title: 'Jardim Suspenso', mediaType: 'movie', genres: ['Romance'], runtime: 99, status: 'want' },
  { slug: 'porto-seguro', title: 'Porto Inseguro', mediaType: 'movie', genres: ['Suspense'], runtime: 107, status: 'want' },
  { slug: 'a-oficina', title: 'A Oficina do Tempo', mediaType: 'tv', genres: ['Ficção científica', 'Animação'], runtime: 22, status: 'want' },
  { slug: 'sal-grosso', title: 'Sal Grosso', mediaType: 'movie', genres: ['Comédia', 'Drama'], runtime: 94, status: 'dropped', rating: 4 },
];

/** Instante de N dias atrás, às 21h locais: a "sessão da noite" cai sempre no mesmo dia civil do navegador. */
const nightsAgo = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(21, 0, 0, 0);
  return d.toISOString();
};

const setCatalogFields = db.query('UPDATE titles SET genres = ?, runtime_minutes = ? WHERE id = ?');
// Histórico com id fixo + OR IGNORE: rodar o seed de novo não duplica eventos.
// "Adicionado" e as datas da entrada nascem com o instante do seed; recuar espalha a atividade pelos dias da semana.
const backdateAdded = db.query("UPDATE library_history SET at = ?1 WHERE title_id = ?2 AND kind = 'added'");
const backdateEntry = db.query('UPDATE library_entries SET added_at = ?1, updated_at = ?2 WHERE title_id = ?3');
const addHistory = db.query('INSERT OR IGNORE INTO library_history (id, title_id, kind, at, detail) VALUES (?, ?, ?, ?, ?)');

for (const [title, genres, runtime] of [
  [horizonte, ['Ficção científica', 'Drama'], 45],
  [farol, ['Mistério', 'Drama'], 50],
  [mare, ['Drama', 'Romance'], 30],
  [sinfonia, ['Drama'], 122],
  [codice, ['Aventura', 'Mistério'], 110],
  [constelacao, ['Ficção científica'], 130],
] as const) {
  setCatalogFields.run(JSON.stringify(genres), runtime, title.id);
}
addHistory.run('seed-farol-finished', farol.id, 'finished', nightsAgo(55), null);

for (const demo of DEMO) {
  const title = upsertTitle(db, {
    source: 'tmdb',
    sourceId: `demo-${demo.slug}`,
    mediaType: demo.mediaType,
    title: demo.title,
    overview: 'Título fictício do catálogo de demonstração.',
    releaseDate: addDays(-(demo.finishedDaysAgo ?? 30) - 120),
    voteAverage: demo.rating ?? 7,
  });
  setCatalogFields.run(JSON.stringify(demo.genres), demo.runtime, title.id);
  if (demo.mediaType === 'tv') {
    const season = upsertSeason(db, title.id, { seasonNumber: 1, name: 'Temporada 1', airDate: addDays(-400) });
    replaceEpisodes(
      db,
      season.id,
      Array.from({ length: 8 }, (_, i) => ({ episodeNumber: i + 1, name: `Episódio ${i + 1}`, airDate: addDays(-400 + i * 7), runtime: demo.runtime })),
    );
  }
  const watchingTv = demo.status === 'watching' && demo.mediaType === 'tv';
  upsertLibraryEntry(db, title.id, {
    watchStatus: demo.status,
    rating: demo.rating ?? null,
    ...(watchingTv ? { currentSeason: 1, currentEpisode: 5 } : {}),
  });
  const lastTouch = demo.rewatchedDaysAgo ?? demo.finishedDaysAgo ?? DEMO.indexOf(demo);
  const addedDaysAgo = (demo.finishedDaysAgo ?? DEMO.indexOf(demo) * 3) + 11;
  backdateAdded.run(nightsAgo(addedDaysAgo), title.id);
  backdateEntry.run(nightsAgo(addedDaysAgo), nightsAgo(lastTouch), title.id);
  if (demo.finishedDaysAgo !== undefined) {
    addHistory.run(`seed-${demo.slug}-finished`, title.id, 'finished', nightsAgo(demo.finishedDaysAgo), null);
    // Série: três noites de episódios antes do fim, para o mapa de atividade ter sequências.
    if (demo.mediaType === 'tv') {
      for (let n = 1; n <= 3; n++) addHistory.run(`seed-${demo.slug}-progress-${n}`, title.id, 'progress', nightsAgo(demo.finishedDaysAgo + n), `T1 E${8 - n}`);
    }
  }
  if (demo.rewatchedDaysAgo !== undefined) {
    addHistory.run(`seed-${demo.slug}-rewatch`, title.id, 'rewatch_started', nightsAgo(demo.rewatchedDaysAgo), null);
    addHistory.run(`seed-${demo.slug}-rewatch-end`, title.id, 'finished', nightsAgo(demo.rewatchedDaysAgo - 1), null);
  }
  if (watchingTv) {
    for (let n = 0; n < 5; n++) addHistory.run(`seed-${demo.slug}-progress-${n}`, title.id, 'progress', nightsAgo(n * 2 + 1), `T1 E${5 - n}`);
  }
}

console.log(`seed concluído em ${todayIso()} — ${6 + DEMO.length} títulos, biblioteca e histórico populados.`);
