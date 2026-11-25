import { Tabs } from '@juninmd/sonido';
import { useState } from 'react';
import type { AddonStreamGroup, AddonStreamItem } from '../addons/stream-lookup.ts';
import { StreamsPanel } from '../addons/title-streams-panel.tsx';
import type { TitleStreamsDto } from '../api/stremio.ts';
import { episodeCode, type EpisodeView } from '../catalog/episode-browser-model.ts';
import { playPath, type StreamPick } from './episode-play-model.ts';
import { EpisodeQueue } from './episode-play-queue.tsx';
import type { PlayContext } from './play-context.ts';

export type Streams =
  | { kind: 'loading' }
  | { kind: 'none'; message: string; alert?: boolean }
  | { kind: 'ready'; dto: TitleStreamsDto; pick: StreamPick | null };

export interface EpisodePlaySideProps {
  ctx: PlayContext;
  list: EpisodeView[];
  ep: EpisodeView;
  marker: PlayContext['marker'];
  streams: Streams;
  hd: string | null;
  /** Palco do player do episódio: o painel de fontes toca lá (portal), não dentro da lateral. */
  host: HTMLElement | null;
  onPick(group: AddonStreamGroup, stream: AddonStreamItem): boolean;
}

/** Lateral do player do episódio: abas com a fila da temporada e as fontes dos addons ("Onde assistir"). */
export function EpisodePlaySide({ ctx, list, ep, marker, streams, hd, host, onPick }: EpisodePlaySideProps) {
  const [tab, setTab] = useState<'q' | 's'>('q');
  const query = ctx.query(ep);
  const pick = streams.kind === 'ready' ? streams.pick : null;
  return (
    <aside className="watch-next play-side" aria-label="Episódios e fontes">
      <Tabs
        label="Painel lateral"
        variant="pill"
        idPrefix="play-tabs"
        hasPanels
        value={tab}
        onChange={setTab}
        items={[
          { key: 'q', label: `Episódios · T${ep.season}` },
          { key: 's', label: 'Onde assistir' },
        ]}
      />
      <EpisodeQueue ctx={ctx} list={list} current={ep} marker={marker} hidden={tab !== 'q'} />
      <div
        id="play-tabs-panel-s"
        role="tabpanel"
        aria-labelledby="play-tabs-s"
        className="play-panel"
        hidden={tab !== 's'}
      >
        {streams.kind === 'loading' && <p className="hint">Procurando fontes…</p>}
        {streams.kind === 'none' &&
          (streams.message === 'Nenhum addon de streams instalado.' ? (
            <p className="hint">
              Instale um addon de streams em <a href="#/addons">Addons</a> para assistir aqui.
            </p>
          ) : (
            <p className="hint" role={streams.alert ? 'alert' : undefined}>
              {streams.message}
            </p>
          ))}
        {streams.kind === 'ready' && !('unavailable' in query) && (
          <StreamsPanel
            dto={streams.dto}
            title={`${ctx.seriesTitle} · ${episodeCode(ep)}`}
            posterUrl={hd}
            route={playPath(ctx.source, ctx.id, ep.season, ep.number)}
            captions={{
              query: ep.name,
              ...(query.tmdbId ? { tmdbId: query.tmdbId } : {}),
              mediaType: query.mediaType,
              season: ep.season,
              episode: ep.number,
            }}
            playerHost={host}
            onPick={onPick}
            autoPlay={pick}
          />
        )}
      </div>
    </aside>
  );
}
