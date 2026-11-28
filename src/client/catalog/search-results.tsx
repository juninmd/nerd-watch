import { Button } from '@juninmd/sonido';
import { useState } from 'react';
import { addonItemPath } from '../addons/addon-links.ts';
import { type AddonSearchHitDto, addToLibrary, type CatalogSource, type SearchResultDto } from '../api/index.ts';
import { navigate } from '../app/router.ts';
import { showToast } from '../app/state.ts';
import { PosterCard } from '../ui/poster-card.tsx';
import { titlePath } from '../ui/title-link.ts';

/** Selo da fonte: tmdb usa o tipo (filme/série); as demais fontes dizem de onde vem. */
const SOURCE_LABEL: Partial<Record<CatalogSource, string>> = {
  archive: 'domínio público',
  tvmaze: 'série · TVmaze',
  anilist: 'anime · AniList',
};

/** Linha sob o título: fonte e ano (a nota vai no selo do pôster). Sem DOM: testável. */
export const resultMeta = (r: Pick<SearchResultDto, 'source' | 'mediaType' | 'releaseDate'>): string =>
  [SOURCE_LABEL[r.source] ?? (r.mediaType === 'tv' ? 'série' : 'filme'), r.releaseDate?.slice(0, 4)]
    .filter(Boolean)
    .join(' · ');

/** O catálogo guarda o caminho da TMDB sem o prefixo de tamanho; o acervo guarda a URL inteira. */
export const posterPathOf = (r: SearchResultDto): string | null | undefined =>
  r.source === 'archive' ? r.posterUrl : r.posterUrl?.replace(/^https:\/\/image\.tmdb\.org\/t\/p\/w\d+/, '');

/** Cartão de resultado do catálogo, com "+ biblioteca" sem sair da busca. */
export function ResultCard({ r }: { r: SearchResultDto }) {
  const [busy, setBusy] = useState(false);
  const add = () => {
    setBusy(true);
    addToLibrary({
      source: r.source,
      sourceId: r.sourceId,
      mediaType: r.mediaType,
      title: r.title,
      overview: r.overview,
      posterPath: posterPathOf(r),
      releaseDate: r.releaseDate,
      voteAverage: r.voteAverage,
    })
      .then(() => showToast(`"${r.title}" adicionado à sua lista`))
      .catch(() => showToast('não foi possível adicionar'))
      .finally(() => setBusy(false));
  };
  return (
    <div className="search-hit">
      <PosterCard
        title={r.title}
        posterUrl={r.posterUrl}
        meta={resultMeta(r)}
        score={r.voteAverage}
        isPublicDomain={r.source === 'archive'}
        onClick={() => navigate(titlePath(r.source, r.source === 'archive' ? '_' : r.mediaType, r.sourceId))}
      />
      <Button
        className="search-hit__add"
        size="sm"
        loading={busy}
        aria-label={`Adicionar ${r.title} à biblioteca`}
        onClick={add}
      >
        + biblioteca
      </Button>
    </div>
  );
}

/** Item de catálogo de addon: abre na tela do addon. */
export function AddonHitCard({ r }: { r: AddonSearchHitDto }) {
  return (
    <PosterCard
      title={r.name}
      posterUrl={r.poster}
      meta={[r.addonName, r.year].filter(Boolean).join(' · ')}
      onClick={() => navigate(addonItemPath(r.addonId, r.type, r.id))}
    />
  );
}
