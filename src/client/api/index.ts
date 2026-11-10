/**
 * Cliente HTTP da API local, um módulo por domínio. Este barril só reexporta: código novo pode importar
 * direto do módulo do domínio (`./library.ts`, `./telegram.ts`, ...).
 */
export * from './backup.ts';
export * from './calendar.ts';
export * from './catalog.ts';
export * from './health.ts';
export * from './http.ts';
export * from './library.ts';
export * from './stats.ts';
export * from './subtitles.ts';
export * from './telegram.ts';
export * from './torrent.ts';
