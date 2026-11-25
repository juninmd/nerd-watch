import type { CatalogSource } from '../api/index.ts';
import { AnilistTitle } from './title-page-anilist.tsx';
import { ArchiveTitle } from './title-page-archive.tsx';
import { TmdbTitle } from './title-page-tmdb.tsx';
import { TvmazeTitle } from './title-page-tvmaze.tsx';

export interface TitlePageProps {
  source: CatalogSource;
  mediaType: 'movie' | 'tv' | '_';
  id: string;
}

/** Ficha de um título: cada fonte tem a sua tela, com o mesmo hero e a mesma coluna lateral. */
export function TitlePage({ source, mediaType, id }: TitlePageProps) {
  if (source === 'archive') return <ArchiveTitle identifier={id} />;
  if (source === 'tvmaze') return <TvmazeTitle id={id} />;
  if (source === 'anilist') return <AnilistTitle id={id} />;
  return <TmdbTitle mediaType={mediaType === 'tv' ? 'tv' : 'movie'} id={id} />;
}
