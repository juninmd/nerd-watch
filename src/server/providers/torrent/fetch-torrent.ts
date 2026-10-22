import parseTorrent, { type ParsedTorrent, toTorrentFile } from 'parse-torrent';
import { type TorrentRef, cleanName, isPrivateHost, parseInfoHash, safeTrackers } from '../../torrent/magnet.ts';
import { SourceError } from '../sources/types.ts';

/** Um `.torrent` típico tem poucos KB; 5 MB cabe até listas enormes sem deixar o download virar DoS. */
export const TORRENT_FILE_MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Só `https:` e host público. `http:` é recusado de propósito: o `.torrent` é a âncora de confiança
 * (infohash + trackers), e por http um intermediário na rede troca o arquivo inteiro sem ninguém notar.
 */
export const httpsTorrentUrl = (input: string): URL => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SourceError('informe um magnet link (magnet:?xt=urn:btih:…) ou a URL https de um arquivo .torrent', 400);
  }
  if (url.protocol === 'http:') throw new SourceError('o .torrent precisa vir por https:// (http permite trocar o arquivo no caminho)', 400);
  if (url.protocol !== 'https:') throw new SourceError('informe um magnet link (magnet:?xt=urn:btih:…) ou a URL https de um arquivo .torrent', 400);
  if (url.username || url.password) throw new SourceError('a URL do .torrent não pode ter usuário e senha', 400);
  if (isPrivateHost(url.hostname)) throw new SourceError('o host do .torrent é local ou privado; use um endereço público', 400);
  return url;
};

const fetchOnce = async (url: URL): Promise<Response> => {
  try {
    // `manual`: cada salto é conferido aqui, nunca seguido pelo fetch sem olhar para onde vai.
    return await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    throw new SourceError('não consegui baixar o .torrent agora (rede ou tempo esgotado)', 502);
  }
};

/** Lê o corpo com teto, sem confiar só no Content-Length (ele pode faltar ou mentir). */
const readCapped = async (res: Response): Promise<Uint8Array> => {
  const declared = res.headers.get('content-length');
  if (declared !== null && Number(declared) > TORRENT_FILE_MAX_BYTES) {
    await res.body?.cancel();
    throw new SourceError('o .torrent é grande demais (limite de 5 MB)', 502);
  }
  if (!res.body) throw new SourceError('o .torrent veio vazio', 502);

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > TORRENT_FILE_MAX_BYTES) {
        await reader.cancel();
        throw new SourceError('o .torrent é grande demais (limite de 5 MB)', 502);
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof SourceError) throw err;
    throw new SourceError('a leitura do .torrent falhou no meio do caminho', 502);
  }
  if (total === 0) throw new SourceError('o .torrent veio vazio', 502);

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

/**
 * Baixa o `.torrent` seguindo redirecionamento só para a MESMA origem. Redirect para outro host é
 * recusado com instrução para colar o link final: o `archive.org/download/…` responde 302 para um
 * `*.archive.org` de outro host, e seguir isso sem olhar seria aceitar um destino escolhido pelo
 * servidor de origem.
 */
export const fetchTorrentBytes = async (start: URL): Promise<Uint8Array> => {
  let current = start;
  for (let hop = 0; ; hop++) {
    const res = await fetchOnce(current);
    if (REDIRECT_STATUSES.has(res.status)) {
      await res.body?.cancel();
      const location = res.headers.get('location');
      if (!location) throw new SourceError('o host redirecionou o .torrent sem dizer para onde', 502);
      if (hop >= MAX_REDIRECTS) throw new SourceError('o .torrent redirecionou demais', 502);
      const next = new URL(location, current);
      if (next.origin !== current.origin || next.protocol !== 'https:') {
        throw new SourceError('o .torrent redireciona para outro endereço; cole o link final do arquivo (o que o navegador baixa)', 400);
      }
      current = next;
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new SourceError(`o host respondeu ${res.status} para o .torrent`, 502);
    }
    return readCapped(res);
  }
};

export interface NormalizedTorrent {
  ref: TorrentRef;
  /**
   * O `.torrent` recodificado só com trackers seguros e sem web seeds. O `info` não muda, então o
   * infohash é o mesmo. Usar este arquivo no engine dá a metadata sem depender de peers; o magnet
   * só é necessário depois de um restart.
   */
  file: Buffer;
}

/**
 * Lê o `.torrent` baixado e devolve a referência e a versão normalizada. O conteúdo dos arquivos
 * não sai daqui: vem pela metadata do próprio `info` (ou dos peers, no caminho do magnet).
 */
export const normalizeTorrentBytes = async (bytes: Uint8Array): Promise<NormalizedTorrent> => {
  const invalid = () => new SourceError('o arquivo baixado não é um .torrent válido', 502);
  let parsed: ParsedTorrent;
  try {
    parsed = await parseTorrent(bytes);
  } catch {
    throw invalid();
  }
  // `parseTorrent` aceita 20 bytes quaisquer como infohash cru (ver `loadTrustedTorrentBuffer` na Archive).
  // Um torrent de verdade descreve pelo menos um arquivo.
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) throw invalid();
  const infoHash = parseInfoHash(parsed.infoHash);
  if (!infoHash) throw invalid();

  const trackers = safeTrackers(parsed.announce ?? []);
  const file = Buffer.from(toTorrentFile({ ...parsed, announce: trackers, urlList: [] }));
  // Falha fechada: se a recodificação mudou o infohash, o arquivo não é o torrent que o usuário pediu.
  const again = await parseTorrent(file).catch(() => null);
  if (!again || parseInfoHash(again.infoHash) !== infoHash) throw new SourceError('não consegui normalizar este .torrent com segurança', 502);

  return { ref: { infoHash, name: cleanName(parsed.name), trackers }, file };
};
