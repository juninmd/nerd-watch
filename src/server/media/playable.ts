/**
 * O que um `<video>` de navegador toca de fato.
 *
 * Existe como módulo próprio porque duas partes do app precisam da MESMA resposta: o seletor de
 * arquivo do torrent (o que dá pra assistir dentro do app) e o catálogo da Archive (se vale a pena
 * oferecer o player). Escrever a regex duas vezes garantiria que elas divergissem.
 */
export const PLAYABLE_EXTENSIONS = /\.(mp4|m4v|webm)$/i;

export const isPlayableVideo = (fileName: string): boolean => PLAYABLE_EXTENSIONS.test(fileName);
