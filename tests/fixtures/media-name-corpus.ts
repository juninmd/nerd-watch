import type { ParsedMediaName, ParseOptions } from '../../src/server/media-name/parse.ts';

/**
 * Corpus sintético do parser de nomes (nomes inventados: nada aqui é conteúdo de canal real).
 * Cada `expect` é o objeto inteiro: campo ausente significa "não achado", e o teste falha se o parser inventar um.
 */
export interface MediaNameCase {
  input: string;
  expect: ParsedMediaName;
  opts?: ParseOptions;
}

export const MEDIA_NAME_CORPUS: MediaNameCase[] = [
  // Release com pontos e underscores
  {
    input: 'Show.Name.S01E02.1080p.WEB-DL.x264.mkv',
    expect: { title: 'Show Name', season: 1, episode: 2, resolution: '1080p', source: 'WEB-DL', codec: 'H.264' },
  },
  {
    input: 'Show_Name_s02e10_720p_HDTV_x265.mp4',
    expect: { title: 'Show Name', season: 2, episode: 10, resolution: '720p', source: 'HDTV', codec: 'H.265' },
  },
  {
    input: 'The.Office.US.S09E23.Finale.2160p.WEB-DL.DDP5.1.H.264',
    expect: { title: 'The Office US', season: 9, episode: 23, resolution: '2160p', source: 'WEB-DL', codec: 'H.264' },
  },
  { input: 'Show.S01E02.mkv', expect: { title: 'Show', season: 1, episode: 2 } },
  { input: 'Show S01 E03', expect: { title: 'Show', season: 1, episode: 3 } },
  { input: 'S01E02', expect: { title: '', season: 1, episode: 2 } },
  { input: 'Show Name 1080p S01E02', expect: { title: 'Show Name', season: 1, episode: 2, resolution: '1080p' } },
  {
    input: 'Movie.Name.2019.1080p.BluRay.x264',
    expect: { title: 'Movie Name', year: 2019, resolution: '1080p', source: 'BluRay', codec: 'H.264' },
  },

  // Intervalos de episódio
  {
    input: 'Serie Nova S01E01-E03 720p',
    expect: { title: 'Serie Nova', season: 1, episode: 1, episodeEnd: 3, resolution: '720p' },
  },
  { input: 'Serie Nova S01E01E02', expect: { title: 'Serie Nova', season: 1, episode: 1, episodeEnd: 2 } },
  { input: 'Show 3x14-15 HDTV', expect: { title: 'Show', season: 3, episode: 14, episodeEnd: 15, source: 'HDTV' } },
  { input: 'Show S01E05-03', expect: { title: 'Show', season: 1, episode: 5 } },

  // NxM e resolução em WxH
  { input: 'Série Teste 1x02 Dublado', expect: { title: 'Série Teste', season: 1, episode: 2, audio: 'dubbed' } },
  { input: 'Show 2x4 1080p', expect: { title: 'Show', season: 2, episode: 4, resolution: '1080p' } },
  { input: '1920x1080 Movie', expect: { title: 'Movie', resolution: '1080p' } },

  // Português: temporada, episódio, abreviações
  { input: 'Temporada 2 Episódio 3 - Legendado', expect: { title: '', season: 2, episode: 3, audio: 'subtitled' } },
  { input: 'A Grande Serie Temporada 2 Episodio 3', expect: { title: 'A Grande Serie', season: 2, episode: 3 } },
  {
    input: 'Serie Teste Temporada 2 Ep. 3 1080p',
    expect: { title: 'Serie Teste', season: 2, episode: 3, resolution: '1080p' },
  },
  { input: 'Serie Teste Temp 1 Cap 12', expect: { title: 'Serie Teste', season: 1, episode: 12 } },
  { input: 'Serie Temporada 3 1080p', expect: { title: 'Serie', season: 3, resolution: '1080p' } },
  { input: 'Serie Episódio 7', expect: { title: 'Serie', episode: 7 } },
  { input: 'T02E03 Nome', expect: { title: '', season: 2, episode: 3 } },
  {
    input: 'T02E03 Nome',
    opts: { seriesTitle: 'Minha Serie' },
    expect: { title: 'Minha Serie', season: 2, episode: 3 },
  },
  { input: 'Show T02E03', expect: { title: 'Show', season: 2, episode: 3 } },

  // Anime: "Título - 12", grupo entre colchetes
  { input: 'Title - 12 [1080p]', expect: { title: 'Title', episode: 12, resolution: '1080p' } },
  {
    input: '[Erai-raws] Title - 12 [1080p][HEVC]',
    expect: { title: 'Title', episode: 12, resolution: '1080p', codec: 'H.265', group: 'Erai-raws' },
  },
  {
    input: '[SubsPlease] Some Show - 07v2 (1080p) [ABCD1234].mkv',
    expect: { title: 'Some Show', episode: 7, resolution: '1080p', group: 'SubsPlease' },
  },
  { input: 'Title - 12 - Episode Name [720p]', expect: { title: 'Title', episode: 12, resolution: '720p' } },
  {
    input: 'Title - 12 [1080p] [Dublado]',
    expect: { title: 'Title', episode: 12, resolution: '1080p', audio: 'dubbed' },
  },
  {
    input: 'Japanese Show - 05 Japonês Legendado',
    expect: { title: 'Japanese Show', episode: 5, audio: 'subtitled', languageHints: ['ja'] },
  },
  { input: '[Erai-raws]', expect: { title: '', group: 'Erai-raws' } },
  { input: '[1080p]', expect: { title: '', resolution: '1080p' } },

  // Anos: entre parênteses, solto, e títulos com números
  { input: 'Se7en (1995) 1080p', expect: { title: 'Se7en', year: 1995, resolution: '1080p' } },
  { input: 'Blade Runner 2049 (2017) 1080p', expect: { title: 'Blade Runner 2049', year: 2017, resolution: '1080p' } },
  { input: '1917 2019 1080p', expect: { title: '1917', year: 2019, resolution: '1080p' } },
  { input: '1917 1080p', expect: { title: '1917', resolution: '1080p' } },
  { input: '2012', expect: { title: '2012' } },
  { input: '2012 (2009) 720p', expect: { title: '2012', year: 2009, resolution: '720p' } },
  { input: 'Movie 2019', expect: { title: 'Movie', year: 2019 } },
  {
    input: 'Mad Max Fury Road 2015 2160p UHD BluRay',
    expect: { title: 'Mad Max Fury Road', year: 2015, resolution: '2160p', source: 'BluRay' },
  },
  {
    input: '2001: Uma Odisseia no Espaço (1968) 1080p',
    expect: { title: '2001: Uma Odisseia no Espaço', year: 1968, resolution: '1080p' },
  },
  { input: 'Fahrenheit 451 (1966) HDTV', expect: { title: 'Fahrenheit 451', year: 1966, source: 'HDTV' } },
  { input: '9 Songs 2004 720p', expect: { title: '9 Songs', year: 2004, resolution: '720p' } },
  { input: 'Se7en', expect: { title: 'Se7en' } },
  { input: 'T2 Trainspotting 1080p', expect: { title: 'T2 Trainspotting', resolution: '1080p' } },
  { input: 'Movie 2 1080p', expect: { title: 'Movie 2', resolution: '1080p' } },
  { input: 'Filme 2 Dublado', expect: { title: 'Filme 2', audio: 'dubbed' } },

  // Palavras comuns que também são tags: só viram tag depois do título
  { input: 'Cam Newton Story', expect: { title: 'Cam Newton Story' } },
  { input: 'The Web Series S02E04', expect: { title: 'The Web Series', season: 2, episode: 4 } },
  { input: 'Web Therapy S01E01', expect: { title: 'Web Therapy', season: 1, episode: 1 } },
  { input: 'Dual Survival S03E01 720p', expect: { title: 'Dual Survival', season: 3, episode: 1, resolution: '720p' } },
  { input: 'The Special Edition 1080p', expect: { title: 'The Special Edition', resolution: '1080p' } },
  { input: 'Nacional Geographic S01E01', expect: { title: 'Nacional Geographic', season: 1, episode: 1 } },
  { input: 'Movie CAM', expect: { title: 'Movie', source: 'CAM' } },
  // Regressões da revisão: possessivo, título que começa com palavra de ruído, codec com grupo, tag de linha vs colchete
  { input: "Ocean's 8 2018 1080p", expect: { title: "Ocean's 8", year: 2018, resolution: '1080p' } },
  { input: "Ocean's 8", expect: { title: "Ocean's 8" } },
  { input: 'Opus 2019 1080p', expect: { title: 'Opus', year: 2019, resolution: '1080p' } },
  { input: 'Movie.2019.1080p.WEB-DL.x264-GRP', expect: { title: 'Movie', year: 2019, resolution: '1080p', source: 'WEB-DL', codec: 'H.264' } },
  { input: 'Movie 720p [1080p]', expect: { title: 'Movie', resolution: '720p' } },
  { input: 'Movie Name 1080p\nSinopse: filme de 1999 [2001]', expect: { title: 'Movie Name', resolution: '1080p' } },
  {
    input: 'Show Special S01E00 1080p',
    expect: { title: 'Show', season: 1, episode: 0, resolution: '1080p', isSpecial: true },
  },
  {
    input: 'Show S00E03 1080p',
    expect: { title: 'Show', season: 0, episode: 3, resolution: '1080p', isSpecial: true },
  },
  { input: 'Serie de Teste 1080p Extras', expect: { title: 'Serie de Teste', resolution: '1080p', isSpecial: true } },

  // Áudio e idioma
  {
    input: 'Filme Exemplo 2020 Dual Audio 1080p',
    expect: { title: 'Filme Exemplo', year: 2020, audio: 'dual', resolution: '1080p' },
  },
  {
    input: 'Filme Exemplo Dublado e Legendado 1080p',
    expect: { title: 'Filme Exemplo', audio: 'dual', resolution: '1080p' },
  },
  {
    input: 'Filme Exemplo Legendado PT-BR',
    expect: { title: 'Filme Exemplo', audio: 'subtitled', languageHints: ['pt-BR'] },
  },
  {
    input: 'Filme Exemplo PT BR Dublado',
    expect: { title: 'Filme Exemplo', audio: 'dubbed', languageHints: ['pt-BR'] },
  },
  {
    input: 'Show S01E02 English 720p',
    expect: { title: 'Show', season: 1, episode: 2, resolution: '720p', languageHints: ['en'] },
  },
  { input: 'Show S01E02 Inglês', expect: { title: 'Show', season: 1, episode: 2, languageHints: ['en'] } },
  { input: 'Filme Exemplo Dublado', expect: { title: 'Filme Exemplo', audio: 'dubbed' } },

  // Ruído de canal: emoji, hashtag, link, menção, separadores
  {
    input: '🎬 Filme Exemplo (2021) 🔥 1080p #cinema @canal_teste https://t.me/canal_teste/123',
    expect: { title: 'Filme Exemplo', year: 2021, resolution: '1080p' },
  },
  {
    input: '🍿 Serie Teste | S01E04 | 720p | HEVC | Dublado ✅',
    expect: { title: 'Serie Teste', season: 1, episode: 4, resolution: '720p', codec: 'H.265', audio: 'dubbed' },
  },
  { input: 'Filme Exemplo 2021\nSinopse: um texto sem tags nenhuma', expect: { title: 'Filme Exemplo', year: 2021 } },
  { input: 'Movie Title [Group]', expect: { title: 'Movie Title' } },
  {
    input: 'Movie Name [WEB-DL 1080p] [Dublado]',
    expect: { title: 'Movie Name', source: 'WEB-DL', resolution: '1080p', audio: 'dubbed' },
  },

  // Acentos e unicode
  { input: 'Amélie Poulain 2001 1080p', expect: { title: 'Amélie Poulain', year: 2001, resolution: '1080p' } },
  {
    input: 'Pokémon Journeys S02E05 PT-BR',
    expect: { title: 'Pokémon Journeys', season: 2, episode: 5, languageHints: ['pt-BR'] },
  },
  {
    input: 'Órfã da Estrada.2009.720p.Dublado.x264.mp4',
    expect: { title: 'Órfã da Estrada', year: 2009, resolution: '720p', audio: 'dubbed', codec: 'H.264' },
  },
  { input: 'Amélie', expect: { title: 'Amélie' } },

  // Ambíguo: o parser não chuta o que não está no texto
  { input: 'Movie 2019 Director Cut 1080p', expect: { title: 'Movie 2019 Director Cut', resolution: '1080p' } },
  { input: 'Show 12 1080p', expect: { title: 'Show 12', resolution: '1080p' } },
  { input: 'Movie Title - Part 2 1080p', expect: { title: 'Movie Title - Part 2', resolution: '1080p' } },
  { input: 'E05 1080p', expect: { title: 'E05', resolution: '1080p' } },
  { input: 'Show E05 1080p', expect: { title: 'Show', episode: 5, resolution: '1080p' } },
  { input: 'Nome_Com_Underscores_E05_480p', expect: { title: 'Nome Com Underscores', episode: 5, resolution: '480p' } },
  {
    input: 'Show E05 1080p',
    opts: { seriesTitle: 'Serie' },
    expect: { title: 'Show', episode: 5, resolution: '1080p' },
  },
  { input: 'Se7en Extra Edition', expect: { title: 'Se7en Extra Edition' } },
  { input: 'Movie 1080p 720p', expect: { title: 'Movie', resolution: '1080p' } },
  { input: 'Movie 2160p 4K HDR', expect: { title: 'Movie', resolution: '2160p' } },
  { input: '1080p', expect: { title: '', resolution: '1080p' } },
  { input: 'x264', expect: { title: '', codec: 'H.264' } },
  {
    input: 'Show S01E02 - Título do Episódio 1080p',
    expect: { title: 'Show', season: 1, episode: 2, resolution: '1080p' },
  },

  // Vazio e só espaço
  { input: '', expect: { title: '' } },
  { input: '   \n  ', expect: { title: '' } },
];

/** Limitações conhecidas: o resultado atual é pinado aqui para que mudança de comportamento apareça no teste. */
export const MEDIA_NAME_KNOWN_LIMITS: MediaNameCase[] = [
  // Ano sem parênteses no fim do título: "2049" é lido como ano
  { input: 'Blade Runner 2049 1080p', expect: { title: 'Blade Runner', year: 2049, resolution: '1080p' } },
  // Ponto em sigla vira espaço
  {
    input: 'E.T. the Extra-Terrestrial 1982 1080p',
    expect: { title: 'E T the Extra-Terrestrial', year: 1982, resolution: '1080p' },
  },
];
