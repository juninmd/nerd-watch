import { Hono } from 'hono';
import { getDb } from '../db/database.ts';
import { assertKnownKeys, guardInput, readJsonObject } from '../http/json-body.ts';
import { hasControlChar } from '../lib/text-guards.ts';
import { ValidationError } from '../lib/validation-error.ts';
import { boardsOf } from '../providers/stremio/boards.ts';
import { AddonError } from '../providers/stremio/client.ts';
import { type AddonStream, fetchCatalog, fetchManifestFrom, fetchMeta, fetchStreams } from '../providers/stremio/protocol.ts';
import { streamsForTitle } from '../providers/stremio/title-streams.ts';
import { parseAddonUrl } from '../providers/stremio/url.ts';
import { deleteAddon, getAddon, type InstalledAddon, listAddons, saveAddon } from '../repo/stremio-addons.ts';
import { subtitleFailureText } from './subtitles-vtt.ts';
import { loadSubtitleAsVtt } from '../subtitles/load.ts';
import { addonMagnet, type AddonTorrentRef } from '../torrent/addon-torrent.ts';
import type { EpisodeHint } from '../torrent/episode-file.ts';
import {
  TorrentBadFileIndexError,
  TorrentDisabledError,
  TorrentNoPlayableVideoError,
  TorrentUnavailableError,
  openP2pVideo,
} from '../torrent/engine.ts';
import { MagnetError } from '../torrent/magnet.ts';

export const stremioRoutes = new Hono();

const IMDB_ID_RE = /^tt\d{5,10}$/;
/** Id de episódio do protocolo (`tt123:2:5`) → temporada e episódio, para achar o arquivo no pack. */
const SERIES_EPISODE_RE = /:(\d{1,4}):(\d{1,4})$/;
const episodeHintOf = (itemId: string): EpisodeHint | null => {
  const m = SERIES_EPISODE_RE.exec(itemId);
  return m ? { season: Number(m[1]), episode: Number(m[2]) } : null;
};

/** O manifest URL pode ter token no caminho: o cliente só recebe o domínio. */
const toDto = (a: InstalledAddon) => ({
  id: a.id,
  host: new URL(a.baseUrl).host,
  name: a.manifest.name,
  version: a.manifest.version,
  description: a.manifest.description,
  logo: a.manifest.logo,
  types: a.manifest.types,
  resources: a.manifest.resources,
  catalogs: a.manifest.catalogs,
  addedAt: a.addedAt,
});

/** Falha do addon vira 502/504 com mensagem fixa; qualquer outro erro segue para o handler padrão. */
const guardAddon = (c: Parameters<typeof guardInput>[0], run: () => Response | Promise<Response>): Promise<Response> =>
  guardInput(c, async () => {
    try {
      return await run();
    } catch (err) {
      if (err instanceof AddonError) {
        const status = err.failure === 'timeout' ? 504 : err.failure === 'untrusted_url' ? 400 : 502;
        return c.json({ error: err.message }, status);
      }
      throw err;
    }
  });

stremioRoutes.get('/addons', async (c) => c.json({ addons: listAddons(await getDb()).map(toDto) }));

stremioRoutes.post('/addons', (c) =>
  guardAddon(c, async () => {
    const body = await readJsonObject(c);
    assertKnownKeys(body, ['url']);
    const parsed = parseAddonUrl(body.url);
    const manifest = await fetchManifestFrom(parsed.manifestUrl);
    const addon = saveAddon(await getDb(), { manifestUrl: parsed.manifestUrl, baseUrl: parsed.baseUrl, manifest });
    return c.json(toDto(addon), 201);
  }),
);

/** Saúde do addon: rebusca o manifest; o cliente mostra "ok" ou a mensagem fixa do erro. */
stremioRoutes.get('/addons/:id/status', (c) =>
  withAddon(c, async (addon) => {
    try {
      await fetchManifestFrom(addon.manifestUrl);
      return c.json({ ok: true, error: null });
    } catch (err) {
      if (err instanceof AddonError || err instanceof ValidationError) return c.json({ ok: false, error: err.message });
      throw err;
    }
  }),
);

/** Streams de todos os addons para um título do TMDB (ex.: Brazuca, que não tem catálogo). */
stremioRoutes.get('/streams', (c) =>
  guardInput(c, async () => {
    const mediaType = c.req.query('mediaType');
    const imdbRaw = c.req.query('imdbId');
    if (imdbRaw !== undefined && !IMDB_ID_RE.test(imdbRaw)) throw new ValidationError('imdbId inválido');
    const tmdbId = Number(c.req.query('tmdbId'));
    const hasTmdb = Number.isInteger(tmdbId) && tmdbId > 0;
    if ((!hasTmdb && imdbRaw === undefined) || (mediaType !== 'movie' && mediaType !== 'tv')) throw new ValidationError('informe tmdbId ou imdbId e mediaType (movie|tv)');
    const num = (k: string): number | null => {
      const v = c.req.query(k);
      return v && /^\d{1,4}$/.test(v) ? Number(v) : null;
    };
    const addons = listAddons(await getDb());
    return c.json(await streamsForTitle(addons, { mediaType, tmdbId: hasTmdb ? tmdbId : undefined, imdbId: imdbRaw, season: num('season'), episode: num('episode') }));
  }),
);

stremioRoutes.delete('/addons/:id', async (c) => {
  const removed = deleteAddon(await getDb(), c.req.param('id'));
  return removed ? c.json({ ok: true }) : c.json({ error: 'addon não encontrado' }, 404);
});

const withAddon = (c: Parameters<typeof guardInput>[0], run: (a: InstalledAddon) => Promise<Response>): Promise<Response> =>
  guardAddon(c, async () => {
    const addon = getAddon(await getDb(), c.req.param('id') ?? '');
    if (!addon) return c.json({ error: 'addon não encontrado' }, 404);
    return run(addon);
  });

stremioRoutes.get('/addons/:id/catalog/:type/:catalogId', (c) =>
  withAddon(c, async (addon) => {
    const type = c.req.param('type');
    const catalogId = c.req.param('catalogId');
    const catalog = addon.manifest.catalogs.find((k) => k.type === type && k.id === catalogId);
    if (!catalog) throw new ValidationError('catálogo não declarado pelo addon');

    const search = c.req.query('search')?.trim().slice(0, 100) || undefined;
    const skipRaw = c.req.query('skip');
    const skip = skipRaw === undefined ? 0 : /^\d{1,6}$/.test(skipRaw) ? Number(skipRaw) : Number.NaN;
    if (!Number.isFinite(skip)) throw new ValidationError('skip inválido');

    // Gênero e ano só passam se o próprio manifest anunciar o filtro: adivinhar nome de gênero em
    // addon que não filtra devolve catálogo vazio (ou o catálogo inteiro) sem o usuário entender.
    const genre = c.req.query('genre')?.trim() || undefined;
    if (genre !== undefined && (genre.length > 80 || hasControlChar(genre))) throw new ValidationError('genre inválido');
    if (genre && catalog.genres.length > 0 && !catalog.genres.includes(genre)) throw new ValidationError('gênero não declarado por este catálogo');

    const year = c.req.query('year')?.trim() || undefined;
    if (year !== undefined && !/^\d{4}$/.test(year)) throw new ValidationError('year inválido');
    if (year && !catalog.yearFilter) throw new ValidationError('este catálogo não filtra por ano');

    return c.json({ items: await fetchCatalog(addon.baseUrl, type, catalogId, { search, skip, genre, year }) });
  }),
);

/** Quadros (catálogos) de todos os addons instalados, para a tela Descobrir. Sem rede: sai do manifest guardado. */
stremioRoutes.get('/boards', async (c) => c.json({ boards: boardsOf(listAddons(await getDb())) }));

stremioRoutes.get('/addons/:id/meta/:type/:itemId', (c) =>
  withAddon(c, async (addon) => {
    const meta = await fetchMeta(addon.baseUrl, c.req.param('type'), c.req.param('itemId'));
    return meta ? c.json(meta) : c.json({ error: 'item não encontrado no addon' }, 404);
  }),
);

stremioRoutes.get('/addons/:id/streams/:type/:itemId', (c) =>
  withAddon(c, async (addon) => {
    const streams = await fetchStreams(addon.baseUrl, c.req.param('type'), c.req.param('itemId'));
    // `trackers` fica no servidor: o cliente não precisa dele para tocar, e o addon não dita o que vai ao navegador.
    return c.json({
      streams: streams.map((s) => ({
        kind: s.kind,
        title: s.title,
        name: s.name,
        description: s.description,
        url: s.url,
        infoHash: s.infoHash,
        fileIdx: s.fileIdx,
        filename: s.filename,
        videoSize: s.videoSize,
        notWebReady: s.notWebReady,
        bingeGroup: s.bingeGroup,
        countryWhitelist: s.countryWhitelist,
        subtitleLangs: s.subtitleLangs,
        subtitles: s.subtitles.map(({ id, lang }) => ({ id, lang })),
        trackerCount: s.trackerCount,
      })),
    });
  }),
);

/**
 * Legenda que o addon publica para um stream (`stream.subtitles`). O cliente manda a posição na lista,
 * nunca a URL: o servidor reconsulta o addon, baixa a faixa com a mesma barreira das outras legendas
 * (host público, teto de 2 MB, redirect checado) e devolve WebVTT.
 */
stremioRoutes.get('/addons/:id/subtitles/:type/:itemId/:streamIndex/:subIndex', (c) =>
  withAddon(c, async (addon) => {
    const streamIndex = c.req.param('streamIndex');
    const subIndex = c.req.param('subIndex').replace(/\.vtt$/i, '');
    if (!/^\d{1,3}$/.test(streamIndex) || !/^\d{1,3}$/.test(subIndex)) throw new ValidationError('legenda inválida');

    const streams = await fetchStreams(addon.baseUrl, c.req.param('type'), c.req.param('itemId'));
    const track = streams[Number(streamIndex)]?.subtitles[Number(subIndex)];
    if (!track) throw new ValidationError('esta legenda não está mais na lista do addon; recarregue a página');

    const loaded = await loadSubtitleAsVtt(track.url);
    if (!loaded.ok) return c.json({ error: subtitleFailureText(loaded.reason) }, 502);
    return c.body(loaded.vtt, 200, {
      'Content-Type': 'text/vtt; charset=utf-8',
      // A faixa é do addon; um cache curto evita rebaixar o mesmo arquivo a cada seek.
      'Cache-Control': 'private, max-age=3600',
    });
  }),
);

/**
 * Abre o torrent de um stream do addon no engine local e devolve o mesmo contrato de `/api/torrent/open`,
 * então a interface reusa o painel P2P. O `index` é a posição na lista e o addon é reconsultado aqui:
 * um infohash/tracker não vem do cliente, só do que o addon acabou de responder.
 */
stremioRoutes.post('/addons/:id/streams/:type/:itemId/:index/open', (c) =>
  withAddon(c, async (addon) => {
    const index = c.req.param('index');
    if (!/^\d{1,3}$/.test(index)) throw new ValidationError('stream inválido');
    const fileIndexRaw = c.req.query('fileIndex');
    const fileIndex = fileIndexRaw === undefined ? undefined : /^\d{1,6}$/.test(fileIndexRaw) ? Number(fileIndexRaw) : Number.NaN;
    if (fileIndex !== undefined && !Number.isFinite(fileIndex)) throw new ValidationError('fileIndex inválido');

    const streams = await fetchStreams(addon.baseUrl, c.req.param('type'), c.req.param('itemId'));
    const stream: AddonStream | undefined = streams[Number(index)];
    if (!stream) throw new ValidationError('stream não está mais na lista do addon; recarregue a página');
    if (stream.kind !== 'torrent' || !stream.infoHash) throw new ValidationError('este stream não é um torrent');

    const ref: AddonTorrentRef = { infoHash: stream.infoHash, name: stream.filename ?? stream.title, trackers: stream.trackers };
    // Série: o id do protocolo carrega temporada/episódio, e o engine usa isso para achar o arquivo
    // certo quando o pack não vem com `fileIdx`.
    const episode = episodeHintOf(c.req.param('itemId'));
    const open = (index?: number) => openP2pVideo(ref.infoHash, addonMagnet(ref), index, episode ?? undefined);
    let failure: unknown;
    try {
      // Sem escolha do usuário, o `fileIdx` do addon aponta o episódio certo do pack; trocar arquivo no painel manda `fileIndex`.
      return c.json(await open(fileIndex ?? stream.fileIdx ?? undefined));
    } catch (err) {
      failure = err;
    }
    // `fileIdx` de addon às vezes aponta um mkv/legenda: em vez de 400 sem saída, tenta o vídeo tocável do pack.
    if (failure instanceof TorrentBadFileIndexError && fileIndex === undefined && stream.fileIdx !== null) {
      try {
        return c.json(await open(undefined));
      } catch (err) {
        failure = err;
      }
    }
    if (failure instanceof TorrentBadFileIndexError) return c.json({ error: failure.message }, 400);
    if (failure instanceof TorrentNoPlayableVideoError) return c.json({ error: failure.message }, 422);
    if (failure instanceof TorrentDisabledError) return c.json({ error: failure.message }, 501);
    // `TorrentUnsafePathError` estende este: caminho hostil também cai aqui.
    if (failure instanceof TorrentUnavailableError) return c.json({ error: failure.message }, 502);
    if (failure instanceof MagnetError) throw new ValidationError(failure.message);
    throw failure;
  }),
);
