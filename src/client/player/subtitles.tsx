import { Badge, Button, Skeleton } from '@juninmd/sonido';
import { useEffect, useState } from 'react';
import {
  downloadSubtitle,
  searchSubtitles,
  type SubtitleDownloadInput,
  type SubtitleResultDto,
  type SubtitleSearchResponse,
} from '../api/index.ts';
import { showToast } from '../app/state.ts';
import { Icon } from '../ui/icon.tsx';

export interface SubtitlesPanelOptions {
  query?: string;
  tmdbId?: number;
  mediaType?: 'movie' | 'tv';
  season?: number | null;
  episode?: number | null;
}

/**
 * Monta o pedido de download. Os addons respondem por id do IMDb, então o `imdbId` que o servidor
 * devolveu na busca precisa voltar — sem ele o servidor não consegue reencontrar a legenda e o
 * painel levava 404 em todo download de addon.
 */
const downloadPayload = (
  result: SubtitleResultDto,
  opts: SubtitlesPanelOptions,
  imdbId: string | null,
): SubtitleDownloadInput => {
  if (result.fileId !== undefined) return { fileId: result.fileId };
  return {
    source: result.source,
    id: result.id,
    imdbId: imdbId ?? undefined,
    tmdbId: opts.tmdbId,
    mediaType: opts.mediaType,
    season: opts.season ?? null,
    episode: opts.episode ?? null,
  };
};

function DisabledMessage({ reason, unavailable }: { reason: SubtitleSearchResponse['reason']; unavailable: string[] }) {
  if (reason === 'no_imdb_id') {
    return (
      <p className="hint">
        Não deu para identificar este título no IMDb, e as fontes de legenda respondem por id do IMDb. Isso acontece com
        título que a TMDB não vincula (e com o acervo do Internet Archive).
      </p>
    );
  }
  return (
    <p className="hint">
      Busca de legenda desligada — adicione <code>SUBTITLE_ADDONS</code> no <code>.env</code>. O padrão (
      <code>https://opensubtitles-v3.strem.io</code>) é o addon OpenSubtitles do Stremio e{' '}
      <strong>não precisa de chave</strong>. A <code>OPENSUBTITLES_API_KEY</code> é opcional e só soma como segunda
      fonte.
      {unavailable.length > 0 && (
        <>
          <br />
          Fontes indisponíveis: {unavailable.join('; ')}
        </>
      )}
    </p>
  );
}

function ResultRow({ r, opts, imdbId }: { r: SubtitleResultDto; opts: SubtitlesPanelOptions; imdbId: string | null }) {
  const [busy, setBusy] = useState(false);
  const download = () => {
    setBusy(true);
    downloadSubtitle(downloadPayload(r, opts, imdbId))
      .then((res) => {
        window.open(res.url, '_blank', 'noopener,noreferrer');
        showToast(
          res.remaining === undefined
            ? 'legenda baixada'
            : `legenda baixada — ${res.remaining} downloads restantes hoje`,
        );
      })
      .catch(() => showToast('não foi possível baixar essa legenda'))
      .finally(() => setBusy(false));
  };
  return (
    <div className="episode-row subtitle-row">
      <div className="body">
        <div className="head">
          <span className="name">{r.language}</span>
        </div>
        <div className="overview">{r.release || 'release não informado'}</div>
        <div className="overview">
          <Badge>{r.source}</Badge>
          {r.downloads !== null ? ` ${r.downloads.toLocaleString('pt-BR')} downloads` : ''}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        loading={busy}
        iconStart={<Icon name="download" size="sm" />}
        onClick={download}
      >
        baixar
      </Button>
    </div>
  );
}

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'done'; data: SubtitleSearchResponse };

/** Busca de legendas para baixar (arquivo .srt), na lateral da página do título. */
export function SubtitlesPanel(opts: SubtitlesPanelOptions) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const { query, tmdbId, mediaType, season, episode } = opts;
  const searchable = Boolean(query || tmdbId);

  useEffect(() => {
    if (!searchable) return;
    let alive = true;
    setState({ kind: 'loading' });
    searchSubtitles({ query, tmdbId, mediaType, season, episode })
      .then((data) => alive && setState({ kind: 'done', data }))
      .catch(() => alive && setState({ kind: 'error' }));
    return () => {
      alive = false;
    };
  }, [searchable, query, tmdbId, mediaType, season, episode]);

  // Sem consulta nem id não há o que buscar: fica o esqueleto, como antes.
  if (!searchable || state.kind === 'loading') return <Skeleton rows={2} label="buscando legendas" />;
  if (state.kind === 'error') return <p className="hint">não foi possível buscar legendas agora</p>;
  const { data } = state;
  if (!data.enabled) return <DisabledMessage reason={data.reason} unavailable={data.unavailable} />;
  if (data.results.length === 0) {
    return (
      <p className="hint">
        nenhuma legenda encontrada para este título
        {data.unavailable.length > 0 ? ` (fontes indisponíveis: ${data.unavailable.join('; ')})` : ''}
      </p>
    );
  }
  return (
    <div>
      {data.results.slice(0, 8).map((r) => (
        <ResultRow key={`${r.source}::${r.id}`} r={r} opts={opts} imdbId={data.imdbId} />
      ))}
    </div>
  );
}
