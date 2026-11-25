import { Button, FilterChips, Select, Skeleton } from '@juninmd/sonido';
import { useEffect, useState } from 'react';
import type { StreamsQueryResolver } from '../addons/episode-streams.ts';
import {
  countStreamKinds,
  DEFAULT_STREAM_FILTER,
  filterTitleStreams,
  type StreamFilter,
  type StreamKind,
} from '../addons/stream-filter.ts';
import { StreamsPanel } from '../addons/title-streams-panel.tsx';
import { getTitleStreams, type TitleStreamsDto } from '../api/stremio.ts';
import { currentRoute, navigate } from '../app/router.ts';
import { isPlayable } from '../player/episode-play-model.ts';
import { episodeCode, type EpisodeView } from './episode-browser-model.ts';

const KIND_LABEL: Record<Exclude<StreamKind, 'all'>, string> = { p2p: 'P2P', direct: 'Direto', external: 'Externo' };
const QUALITY = [
  { value: '0', label: 'Qualquer qualidade' },
  { value: '720', label: '720p ou mais' },
  { value: '1080', label: '1080p ou mais' },
  { value: '2160', label: '4K' },
];
const SORTS = [
  { value: 'addon', label: 'Ordem do addon' },
  { value: 'seeds', label: 'Mais seeds' },
  { value: 'quality', label: 'Melhor qualidade' },
];

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ok'; dto: TitleStreamsDto };

export interface EpisodeStreamsProps {
  seriesTitle: string;
  ep: EpisodeView;
  streams: (ep: EpisodeView) => ReturnType<StreamsQueryResolver>;
  playPath?: (ep: EpisodeView) => string;
  /** Fecha o modal (antes de ir para o player dedicado ou para Addons). */
  onClose: () => void;
}

/** "Onde assistir" do episódio: links dos addons com filtro por tipo, qualidade mínima e ordem. */
export function EpisodeStreams({ seriesTitle, ep, streams, playPath, onClose }: EpisodeStreamsProps) {
  const [filter, setFilter] = useState<StreamFilter>({ ...DEFAULT_STREAM_FILTER });
  const [res, setRes] = useState<Load>({ status: 'loading' });
  const q = streams(ep);
  const unavailable = 'unavailable' in q ? q.unavailable : null;
  const request = unavailable ? '' : JSON.stringify(q);

  useEffect(() => {
    if ('unavailable' in q) return;
    let live = true;
    setRes({ status: 'loading' });
    getTitleStreams(q)
      .then((dto) => live && setRes({ status: 'ok', dto }))
      .catch(() => live && setRes({ status: 'error' }));
    return () => {
      live = false;
    };
  }, [request]);

  if (unavailable) return <p className="hint">{unavailable}</p>;
  if (res.status === 'loading') return <Skeleton rows={2} label="Consultando os addons…" />;
  if (res.status === 'error') {
    return (
      <p className="hint" role="alert">
        não foi possível consultar os addons agora.
      </p>
    );
  }
  if (!res.dto.addons.length) {
    return (
      <p className="hint">
        Instale um addon de streams em{' '}
        <Button
          variant="link"
          size="sm"
          onClick={() => {
            onClose();
            navigate('/addons');
          }}
        >
          Addons
        </Button>{' '}
        para ver links aqui.
      </p>
    );
  }
  const counts = countStreamKinds(res.dto);
  const kinds = (Object.keys(KIND_LABEL) as Array<Exclude<StreamKind, 'all'>>).filter((k) => counts[k] > 0);
  return (
    <>
      {counts.all > 0 && (
        <div className="ep-stream-tools">
          <FilterChips
            label="Tipo de link"
            allLabel="Todos"
            allCount={counts.all}
            chips={kinds.map((k) => ({ key: k, label: KIND_LABEL[k], count: counts[k] }))}
            value={filter.kind === 'all' ? null : filter.kind}
            onChange={(k) => setFilter({ ...filter, kind: k ?? 'all' })}
          />
          <Select
            label="Qualidade mínima"
            options={QUALITY}
            value={String(filter.minHeight)}
            onChange={(v) => setFilter({ ...filter, minHeight: Number(v) })}
          />
          <Select
            label="Ordenar links"
            options={SORTS}
            value={filter.sort}
            onChange={(v) => setFilter({ ...filter, sort: v as StreamFilter['sort'] })}
          />
        </div>
      )}
      <StreamsPanel
        // Trocar o filtro remonta a lista: o painel antigo encerra o player/torrent que tocava nela.
        key={JSON.stringify(filter)}
        dto={filterTitleStreams(res.dto, filter)}
        title={`${seriesTitle} · ${episodeCode(ep)}`}
        posterUrl={null}
        route={currentRoute().path}
        onPick={(g, st) => {
          if (!playPath || !isPlayable(st)) return false;
          onClose();
          navigate(`${playPath(ep)}?addon=${encodeURIComponent(g.addonId)}&i=${st.index}`);
          return true;
        }}
        // Mesma busca de legendas que a linha de episódio antiga fazia.
        captions={
          'unavailable' in q
            ? null
            : {
                query: ep.name ?? seriesTitle,
                ...(q.tmdbId ? { tmdbId: q.tmdbId } : {}),
                mediaType: q.mediaType,
                season: q.season ?? null,
                episode: q.episode ?? null,
              }
        }
      />
    </>
  );
}
