import { EmptyState, FilterChips, SearchField, Skeleton } from '@juninmd/sonido';
import { useEffect, useState } from 'react';
import { type ArchiveCollectionDto, getArchiveCollections, searchArchive, searchCommons } from '../api/index.ts';
import { navigate } from '../app/router.ts';
import { Icon } from '../ui/icon.tsx';
import { PosterCard, type PosterCardProps } from '../ui/poster-card.tsx';
import { titlePath } from '../ui/title-link.ts';
import { useLoad } from './use-load.ts';

/** Fonte extra além das coleções da Archive: vídeos livres da Wikimedia Commons. */
const COMMONS = 'commons';
const FALLBACK_COLLECTIONS: ArchiveCollectionDto[] = [{ id: 'feature_films', label: 'Longas clássicos' }];

type Item = PosterCardProps & { key: string };

const loadItems = (source: string, q: string): Promise<Item[]> =>
  source === COMMONS
    ? searchCommons(q).then((items) =>
        items.map((v) => ({
          key: v.title,
          title: v.name,
          posterUrl: v.thumbnailUrl,
          meta: v.license,
          isPublicDomain: true,
          onClick: () => navigate(`/commons/${encodeURIComponent(v.title)}`),
        })),
      )
    : searchArchive(q, source).then((data) =>
        data.results.map((m) => ({
          key: m.identifier,
          title: m.title,
          posterUrl: m.thumbnailUrl,
          meta: m.year ?? undefined,
          isPublicDomain: true,
          onClick: () => navigate(titlePath('archive', '_', m.identifier)),
        })),
      );

function Shelf({ source, query }: { source: string; query: string }) {
  const { data, error } = useLoad(() => loadItems(source, query), `${source}\n${query}`);
  if (error)
    return (
      <EmptyState
        icon={<Icon name="alert" />}
        title={`${source === COMMONS ? 'Wikimedia Commons' : 'Internet Archive'} indisponível agora`}
      />
    );
  if (!data) {
    return (
      <div className="grid">
        {Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} media rows={2} label="Carregando acervo…" />
        ))}
      </div>
    );
  }
  if (data.length === 0) return <EmptyState icon={<Icon name="search" />} title="nada encontrado nesse acervo" />;
  return (
    <div className="grid">
      {data.map(({ key, ...card }) => (
        <PosterCard key={key} {...card} />
      ))}
    </div>
  );
}

/** Acervo de domínio público e licença livre: coleções do Internet Archive e vídeos da Wikimedia Commons. */
export function PublicDomainPage() {
  const [collections, setCollections] = useState(FALLBACK_COLLECTIONS);
  const [source, setSource] = useState('feature_films');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    getArchiveCollections()
      .then(setCollections)
      .catch(() => undefined);
  }, []);
  // Espera a pessoa parar de digitar antes de consultar a fonte.
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);
  const sources = [
    ...collections.map((c) => ({ key: c.id, label: `Archive: ${c.label}` })),
    { key: COMMONS, label: 'Wikimedia Commons' },
  ];
  return (
    <div>
      <h1 className="view-title">Domínio público</h1>
      <p className="view-subtitle">
        Filmes e vídeos de domínio público ou licença livre, de fontes que publicam a licença de cada item: coleções do
        Internet Archive (longas clássicos, cinema mudo, film noir, ficção científica e terror, animação, TV clássica,
        Prelinger, NASA) e a Wikimedia Commons (inclui os filmes abertos da Blender Foundation). Sem chave de API.
        Confira sempre a licença mostrada em cada item.
      </p>
      {/* Sempre há uma fonte escolhida: clicar na ativa não a desliga. */}
      <FilterChips label="fonte do acervo" chips={sources} value={source} onChange={(k) => k && setSource(k)} />
      <div className="chip-row pd-search">
        <SearchField
          className="grow"
          value={text}
          onChange={setText}
          label="buscar no acervo"
          placeholder="Buscar no acervo (ex: Chaplin, terror, faroeste)..."
          autoComplete="off"
        />
      </div>
      <Shelf source={source} query={query} />
    </div>
  );
}
