import { EmptyState, FilterChips, SearchField, Select, Skeleton, Switch, Tabs } from '@juninmd/sonido';
import { type Ref, useEffect, useRef, useState } from 'react';
import type { StreamsQueryResolver } from '../addons/episode-streams.ts';
import type { EpisodeMarker } from '../library/episode-progress.ts';
import { Icon } from '../ui/icon.tsx';
import { EpisodeCard } from './episode-card.tsx';
import {
  type EpisodeLayout,
  type EpisodeSort,
  type EpisodeView,
  episodeState,
  filterEpisodes,
  hidesSpoiler,
  seasonPicker,
} from './episode-browser-model.ts';
import { openEpisodeModal } from './episode-modal.tsx';

export interface EpisodeBrowserProps {
  seriesTitle: string;
  seasons: Array<{ number: number; name: string; count: number }>;
  /** Temporada aberta; quem chama guarda, para a linha do tempo da lateral também trocar de aba. */
  season: number;
  onSeasonChange: (season: number) => void;
  /** Carrega uma temporada (TMDB busca sob demanda; TVmaze já tem tudo). */
  load: (season: number) => Promise<EpisodeView[]>;
  /** Mudou = recarrega a temporada aberta (ex.: chegaram notas por episódio). */
  loadKey?: string;
  marker: EpisodeMarker | null;
  streams: (ep: EpisodeView) => ReturnType<StreamsQueryResolver>;
  onMark?: (ep: EpisodeView) => Promise<void>;
  playPath?: (ep: EpisodeView) => string;
  /** Linha extra sob as abas (estreia, final, emissora da temporada). */
  seasonNote?: string;
  sectionRef?: Ref<HTMLElement>;
}

const LAYOUT_KEY = 'nw.episodes.layout';
const REVEAL_KEY = 'nw.episodes.reveal';
const SORTS: Array<{ value: EpisodeSort; label: string }> = [
  { value: 'number', label: 'Ordem de exibição' },
  { value: 'rating', label: 'Maior nota' },
  { value: 'recent', label: 'Mais recentes primeiro' },
];

const loadLayout = (): EpisodeLayout => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
};
const saveLayout = (v: EpisodeLayout): void => {
  try {
    localStorage.setItem(LAYOUT_KEY, v);
  } catch {
    // Preferência só deste navegador: sem armazenamento, vale até recarregar.
  }
};

const loadReveal = (): boolean => {
  try {
    return localStorage.getItem(REVEAL_KEY) === '1';
  } catch {
    return false;
  }
};
const saveReveal = (v: boolean): void => {
  try {
    localStorage.setItem(REVEAL_KEY, v ? '1' : '0');
  } catch {
    // Preferência só deste navegador.
  }
};

type SeasonLoad = { status: 'loading' } | { status: 'error' } | { status: 'ok'; episodes: EpisodeView[] };

/** A temporada aberta, com descarte de resposta antiga (trocou de aba antes de chegar). */
const useSeason = (load: EpisodeBrowserProps['load'], season: number, loadKey: string): SeasonLoad => {
  const [res, setRes] = useState<SeasonLoad>({ status: 'loading' });
  const loaded = useRef(season);
  const request = `${season}#${loadKey}`;
  useEffect(() => {
    let live = true;
    // Outra temporada volta ao esqueleto; recarga da mesma (chegaram notas) mantém a lista na tela.
    if (loaded.current !== season) {
      loaded.current = season;
      setRes({ status: 'loading' });
    }
    load(season)
      .then((episodes) => live && setRes({ status: 'ok', episodes }))
      .catch(() => live && setRes({ status: 'error' }));
    return () => {
      live = false;
    };
  }, [request]);
  return res;
};

/** Episódios com abas de temporada, busca, ordem, "só não vistos" e grade/lista. Clique abre o modal do episódio. */
export function EpisodeBrowser(props: EpisodeBrowserProps) {
  const { seasons, season, marker, onMark } = props;
  const real = seasons.filter((s) => s.count > 0);
  const [layout, setLayout] = useState<EpisodeLayout>(loadLayout);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<EpisodeSort>('number');
  const [onlyUnseen, setOnlyUnseen] = useState(false);
  const [reveal, setReveal] = useState(loadReveal);
  const current = real.some((s) => s.number === season) ? season : (real[0]?.number ?? 1);
  const res = useSeason(props.load, current, props.loadKey ?? '');
  // O modal vive fora desta árvore: lê o marcador mais novo por aqui ao repintar depois de marcar.
  const markerRef = useRef(marker);
  markerRef.current = marker;

  if (real.length === 0) return <EmptyState icon={<Icon name="inbox" />} title="sem episódios listados" />;

  const episodes = res.status === 'ok' ? res.episodes : [];
  const shown = filterEpisodes(episodes, { query, onlyUnseen, sort }, marker);
  const open = (i: number) =>
    openEpisodeModal({
      seriesTitle: props.seriesTitle,
      episodes: shown,
      index: i,
      stateOf: (ep) => episodeState(markerRef.current, ep),
      streams: props.streams,
      onMark,
      playPath: props.playPath,
    });

  return (
    <section ref={props.sectionRef} aria-labelledby="ep-heading">
      <div className="section-head ep-head">
        <h2 id="ep-heading">Episódios</h2>
        <span className="hint">{props.seasonNote ?? ''}</span>
      </div>
      {seasonPicker(real.length) === 'tabs' ? (
        <Tabs
          variant="pill"
          label="Temporadas"
          items={real.map((s) => ({
            key: String(s.number),
            label: s.name,
            badge: <span className="dim">{s.count}</span>,
          }))}
          value={String(current)}
          onChange={(k) => props.onSeasonChange(Number(k))}
        />
      ) : (
        <Select
          className="ep-season-select"
          label="Temporada"
          options={real.map((s) => ({ value: String(s.number), label: `${s.name} · ${s.count} episódios` }))}
          value={String(current)}
          onChange={(k) => props.onSeasonChange(Number(k))}
        />
      )}
      <div className="ep-toolbar">
        <SearchField
          value={query}
          onChange={setQuery}
          label="Buscar episódio"
          placeholder="Buscar episódio"
          autoComplete="off"
        />
        <Select label="Ordenar episódios" options={SORTS} value={sort} onChange={(v) => setSort(v as EpisodeSort)} />
        <FilterChips
          label="Filtro de episódios"
          chips={[{ key: 'unseen', label: 'Só não vistos' }]}
          value={onlyUnseen ? 'unseen' : null}
          onChange={(v) => setOnlyUnseen(v === 'unseen')}
        />
        {marker && (
          <Switch
            label="Mostrar sinopses futuras"
            checked={reveal}
            onChange={(v) => {
              setReveal(v);
              saveReveal(v);
            }}
          />
        )}
        <Tabs
          className="ep-seg"
          variant="pill"
          label="Visualização dos episódios"
          items={[
            { key: 'grid', label: 'Grade', icon: <Icon name="grid" size="sm" /> },
            { key: 'list', label: 'Lista', icon: <Icon name="list" size="sm" /> },
          ]}
          value={layout}
          onChange={(v) => {
            setLayout(v);
            saveLayout(v);
          }}
        />
      </div>
      <div className={layout === 'list' ? 'ep-list' : 'ep-grid'} aria-busy={res.status === 'loading' || undefined}>
        {res.status === 'loading' &&
          Array.from({ length: 6 }, (_, i) => <Skeleton key={i} media rows={2} label="Carregando episódios…" />)}
        {res.status === 'error' && (
          <div role="alert">
            <EmptyState icon={<Icon name="alert" />} title="não foi possível carregar os episódios" />
          </div>
        )}
        {res.status === 'ok' && shown.length === 0 && (
          <EmptyState
            title={episodes.length ? 'nenhum episódio com esses filtros' : 'sem episódios listados para esta temporada'}
          />
        )}
        {shown.map((ep, i) => (
          <EpisodeCard
            key={ep.number}
            ep={ep}
            state={episodeState(marker, ep)}
            onOpen={() => open(i)}
            onMark={onMark ? () => onMark(ep) : undefined}
            spoiler={hidesSpoiler(episodeState(marker, ep), marker, reveal)}
          />
        ))}
      </div>
    </section>
  );
}
