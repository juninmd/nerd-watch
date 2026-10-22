import { MAGNET_MAX_LENGTH, buildMagnet, parseMagnet } from '../../torrent/magnet.ts';
import { SourceError } from '../sources/types.ts';
import { fetchTorrentBytes, httpsTorrentUrl, normalizeTorrentBytes } from './fetch-torrent.ts';

export interface TorrentInput {
  infoHash: string;
  /** Magnet canônico: é o que fica guardado para reabrir depois de um restart. */
  magnet: string;
  /** `.torrent` normalizado, quando a entrada foi uma URL; magnet puro não tem metadata para oferecer. */
  file?: Buffer;
}

/**
 * O que o usuário colou vira o magnet canônico e o infohash. Só dois formatos entram: magnet link
 * e URL https de um `.torrent`. Não existe busca, indexador nem lista de sites: é o que o usuário
 * escolheu, e nada além disso.
 */
export const torrentFromInput = async (input: string): Promise<TorrentInput> => {
  if (input.length > MAGNET_MAX_LENGTH) throw new SourceError('a entrada é grande demais', 400);
  if (/^magnet:/i.test(input)) {
    const ref = parseMagnet(input);
    return { infoHash: ref.infoHash, magnet: buildMagnet(ref) };
  }
  const bytes = await fetchTorrentBytes(httpsTorrentUrl(input));
  const { ref, file } = await normalizeTorrentBytes(bytes);
  return { infoHash: ref.infoHash, magnet: buildMagnet(ref), file };
};
