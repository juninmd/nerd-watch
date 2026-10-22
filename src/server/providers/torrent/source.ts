import { torrentEnabled } from '../../config.ts';
import { getDb } from '../../db.ts';
import { type TorrentSource, getTorrentSource, saveTorrentSource } from '../../repo/torrent-sources.ts';
import { TorrentDisabledError, TorrentUnavailableError, openGenericTorrent } from '../../torrent/engine.ts';
import { MagnetError, parseMagnet } from '../../torrent/magnet.ts';
import { serveTorrentFile } from '../../torrent/serve.ts';
import { registerDescriptor, registerSource } from '../sources/registry.ts';
import { type FileSource, SourceError } from '../sources/types.ts';
import { isVideoFile, toItems } from './items.ts';
import { torrentFromInput } from './input.ts';

const HANDLE_RE = /^torrent:([0-9a-f]{40})$/;
const FILE_REF_RE = /^\d{1,6}$/;

/** Erros internos -> erro de domínio com status certo. A mensagem é nossa, nunca o corpo do host ou do peer. */
const mapError = (err: unknown): never => {
  if (err instanceof SourceError) throw err;
  if (err instanceof MagnetError) throw new SourceError(err.message, 400);
  if (err instanceof TorrentDisabledError) throw new SourceError(err.message, 501);
  if (err instanceof TorrentUnavailableError) throw new SourceError(err.message, 502);
  throw new SourceError('não foi possível abrir este torrent agora', 502);
};

const infoHashOf = (handle: string): string => {
  const match = HANDLE_RE.exec(handle);
  if (!match) throw new SourceError('canal de torrent inválido', 400);
  return match[1] as string;
};

/** Origem guardada na importação, revalidada antes de virar pedido ao engine. */
const storedSource = async (infoHash: string): Promise<TorrentSource> => {
  const row = getTorrentSource(await getDb(), infoHash);
  if (!row) throw new SourceError('torrent não encontrado nesse canal; adicione o canal de novo', 404);
  if (parseMagnet(row.magnet).infoHash !== infoHash) throw new SourceError('origem guardada deste torrent está inconsistente', 404);
  return row;
};

export const torrentSource: FileSource = {
  mode: 'torrent',
  link: () => null,

  async resolve(input) {
    if (!torrentEnabled()) throw new SourceError('torrent desligado (TORRENT_ENABLED=false)', 501);
    try {
      const { infoHash, magnet, file } = await torrentFromInput(input);
      // Abrir antes de gravar: só entra no catálogo o que tem metadata (o .torrent ou os peers).
      const info = await openGenericTorrent(infoHash, magnet, file);
      await saveTorrentSource(await getDb(), infoHash, magnet);
      return { handle: `torrent:${infoHash}`, name: info.name || infoHash };
    } catch (err) {
      return mapError(err);
    }
  },

  async list(handle) {
    try {
      const source = await storedSource(infoHashOf(handle));
      const info = await openGenericTorrent(source.infoHash, source.magnet);
      return toItems(info.files, source.addedAt);
    } catch (err) {
      return mapError(err);
    }
  },

  async play({ handle, fileRef, range }) {
    try {
      const source = await storedSource(infoHashOf(handle));
      if (!FILE_REF_RE.test(fileRef)) throw new SourceError('vídeo não encontrado nesse canal', 404);
      // Reabre se o engine já esqueceu o torrent (ocioso ou após restart); aberto, só reaproveita.
      await openGenericTorrent(source.infoHash, source.magnet);
      return serveTorrentFile(source.infoHash, Number(fileRef), range, 'GET', isVideoFile);
    } catch (err) {
      return mapError(err);
    }
  },
};

export const registerTorrent = (): void => {
  registerSource(torrentSource);
  registerDescriptor({
    id: 'torrent',
    title: 'Torrent',
    description: 'Magnet links e arquivos .torrent que você escolher viram canais.',
    icon: 'download',
    fields: [],
    add: {
      mode: 'torrent',
      label: 'magnet link ou URL https do .torrent',
      placeholder: 'magnet:?xt=urn:btih:… ou https://…/arquivo.torrent',
      hint: 'só adicione conteúdo que você tem direito de assistir',
    },
    configured: torrentEnabled,
    connected: torrentEnabled,
  });
};
