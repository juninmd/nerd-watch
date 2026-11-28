import { EmptyState, FilterChips, Kbd, OmniSearch, Skeleton } from '@juninmd/sonido';
import { useEffect, useState } from 'react';
import { SEARCH_SOURCES, searchSource, suggestTitles } from '../api/catalog.ts';
import { searchTvmazePeople, type TvmazePerson } from '../api/index.ts';
import { navigate } from '../app/router.ts';
import { paletteKeyLabel } from '../app/shortcut-keys.ts';
import { Icon } from '../ui/icon.tsx';
import { countByKind, filterByKind, SEARCH_KINDS, type SearchKind } from './search-filter.ts';
import { readRecent, rememberSearch } from './search-history.ts';
import { addPart, mergedResponse, SOURCE_LABEL, type SearchProgress, startProgress } from './search-progress.ts';
import { AddonHitCard, ResultCard } from './search-results.tsx';
import { PersonCard } from './tvmaze-sections.tsx';

const SUGGEST_DEBOUNCE_MS = 250;

/** Cada fonte responde no seu tempo: a grade cresce conforme chegam, sem esperar a mais lenta. */
function useProgressiveSearch(query: string): SearchProgress {
  const [p, setP] = useState(startProgress);
  useEffect(() => {
    let live = true;
    setP(startProgress());
    for (const source of SEARCH_SOURCES) {
      searchSource(query, source)
        .then((res) => live && setP((cur) => addPart(cur, source, res)))
        .catch(() => live && setP((cur) => addPart(cur, source, null)));
    }
    return () => {
      live = false;
    };
  }, [query]);
  return p;
}

/** Pessoas (elenco e equipe) da TVmaze: busca paralela e opcional, falha não atrapalha os títulos. */
function People({ query }: { query: string }) {
  const [people, setPeople] = useState<TvmazePerson[]>([]);
  useEffect(() => {
    let live = true;
    searchTvmazePeople(query)
      .then(({ results }) => live && setPeople(results.slice(0, 12)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [query]);
  if (people.length === 0) return null;
  return (
    <>
      <div className="section-head">
        <h2>Pessoas</h2>
      </div>
      <div className="tvm-people">
        {people.map((p) => (
          <PersonCard key={p.id} person={p} line1={p.country} line2={p.birthday ? p.birthday.slice(0, 4) : null} />
        ))}
      </div>
    </>
  );
}

function Results({ query }: { query: string }) {
  const progress = useProgressiveSearch(query);
  // Filtro por tipo no cliente (padrão de "Descobrir" de apps de streaming): sem nova chamada à API.
  const [kind, setKind] = useState<SearchKind>('all');
  const data = mergedResponse(progress);
  const waiting = progress.pending.length > 0;
  const empty = data.results.length === 0 && (data.addonResults ?? []).length === 0;
  if (!waiting && empty && progress.failed.length === SEARCH_SOURCES.length) {
    return <EmptyState icon={<Icon name="alert" />} title="falha na busca, tente de novo" />;
  }
  if (waiting && empty) {
    return (
      <div className="grid">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} media rows={2} label="Buscando…" />
        ))}
      </div>
    );
  }
  const addonHits = data.addonResults ?? [];
  // Sem chave da TMDB, filmes e séries do catálogo geral não entram na busca; dizer isso evita
  // a impressão de que "a busca não acha nada" quando só falta configurar a credencial.
  const tmdbOff = data.tmdbEnabled === false && (
    <p className="hint" id="tmdb-off-hint">
      TMDB sem chave: filmes e séries do catálogo geral não aparecem na busca.{' '}
      <a href="#/credentials">Configure a TMDB_API_KEY</a> para pôsteres, trailers e streams por IMDb.
    </p>
  );
  const status = waiting ? (
    <p className="hint search-pending" aria-live="polite">
      Ainda buscando em {progress.pending.map((x) => SOURCE_LABEL[x]).join(', ')}…
    </p>
  ) : progress.failed.length > 0 ? (
    <p className="hint">Sem resposta de {progress.failed.map((x) => SOURCE_LABEL[x]).join(', ')}.</p>
  ) : null;
  if (empty) {
    return (
      <>
        {tmdbOff}
        <EmptyState
          icon={<Icon name="search" />}
          title={`nada encontrado para "${query}"`}
          description="confira a grafia ou tente o nome original do título"
        />
      </>
    );
  }
  const counts = countByKind(data.results, addonHits.length);
  const shown = filterByKind(data.results, kind);
  const addonShown = kind === 'all' || kind === 'addon' ? addonHits : [];
  return (
    <>
      {tmdbOff}
      {status}
      <FilterChips
        label="tipo de resultado"
        allLabel="Tudo"
        allCount={counts.all}
        chips={SEARCH_KINDS.filter((k) => k.id !== 'all' && counts[k.id] > 0).map((k) => ({
          key: k.id,
          label: k.label,
          count: counts[k.id],
        }))}
        value={kind === 'all' ? null : kind}
        onChange={(k) => setKind(k ?? 'all')}
      />
      <div className="grid">
        {shown.map((r) => (
          <ResultCard key={`${r.source}:${r.sourceId}`} r={r} />
        ))}
        {addonShown.map((r) => (
          <AddonHitCard key={`${r.addonId}:${r.type}:${r.id}`} r={r} />
        ))}
      </div>
    </>
  );
}

/** Busca no catálogo inteiro (TMDB, TVmaze, AniList, Internet Archive, addons). A consulta mora na URL (`?q=`). */
export function SearchPage({ query }: { query: string }) {
  const [text, setText] = useState(query);
  const [recent, setRecent] = useState(readRecent);
  const [titles, setTitles] = useState<string[]>([]);
  const typed = text.trim();
  // Títulos sugeridos enquanto digita (debounce); campo vazio mostra as buscas recentes.
  useEffect(() => {
    if (typed.length < 2 || typed === query) {
      setTitles([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      suggestTitles(typed)
        .then((list) => live && setTitles(list.map((x) => x.title)))
        .catch(() => live && setTitles([]));
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [typed, query]);
  const go = (value: string) => {
    const q = value.trim();
    if (q) setRecent(rememberSearch(q));
    setText(q);
    navigate(`/search${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  };
  const showRecent = typed.length === 0;
  return (
    <div>
      <h1 className="view-title">Buscar</h1>
      <p className="view-subtitle">
        Filmes, séries e novelas na TMDB, séries na TVmaze, anime no AniList, o acervo de domínio público do Internet
        Archive e os catálogos dos seus addons Stremio.
      </p>
      <OmniSearch
        className="search-omni"
        value={text}
        onChange={setText}
        label="Buscar no catálogo"
        placeholder="Nome do filme, série ou novela"
        onSubmit={go}
        onClear={() => setText('')}
        suggestions={showRecent ? recent : titles}
        suggestionsTitle={showRecent ? 'Buscas recentes' : 'Títulos'}
        onPickSuggestion={go}
        hint="Enter busca; setas escolhem uma sugestão"
        shortcut={false}
      />
      {query ? (
        <>
          <Results query={query} />
          <People query={query} />
        </>
      ) : (
        <EmptyState
          icon={<Icon name="search" />}
          title="digite o nome de um título acima"
          description={
            <>
              ou use <Kbd>{paletteKeyLabel(navigator.platform)}</Kbd> de qualquer tela
            </>
          }
        />
      )}
    </div>
  );
}
