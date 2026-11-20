import type { TvmazeCastMember, TvmazeCrewMember, TvmazeEpisodeMeta, TvmazeImage, TvmazeMore } from '../../server/providers/tvmaze-more.ts';
import type { TvmazePerson } from '../../server/providers/tvmaze-more.ts';
import type { TvmazePersonDetails } from '../../server/providers/tvmaze-people.ts';
import type { AttributionDto } from './catalog.ts';
import { json } from './http.ts';
import type { PersonBio } from '../../server/providers/wikipedia-bio.ts';
import type { TvmazePersonShow } from '../../server/providers/tvmaze-people.ts';

export type { TvmazeCastMember, TvmazeCrewMember, TvmazeEpisodeMeta, TvmazeImage, TvmazeMore, TvmazePerson, TvmazePersonDetails };
export type TvmazeMoreDto = TvmazeMore & { attribution: AttributionDto };
export type TvmazePersonDto = TvmazePersonDetails & { attribution: AttributionDto };

/** Elenco, equipe, galeria, akas, canais e ids externos de uma série da TVmaze. */
export const getTvmazeMore = (id: string): Promise<TvmazeMoreDto> => fetch(`/api/tvmaze/${encodeURIComponent(id)}/more`).then((r) => json<TvmazeMoreDto>(r));

export const getTvmazePerson = (id: string): Promise<TvmazePersonDto> => fetch(`/api/tvmaze/person/${encodeURIComponent(id)}`).then((r) => json<TvmazePersonDto>(r));

export type { PersonBio } from '../../server/providers/wikipedia-bio.ts';
export type { TvmazePersonShow } from '../../server/providers/tvmaze-people.ts';

export interface TvmazePersonCardDto {
  person: TvmazePersonDetails;
  shows: TvmazePersonShow[];
  /** Resumo da Wikipédia (CC BY-SA); `null` quando não há um confiável para a pessoa. */
  bio: PersonBio | null;
  attribution: AttributionDto;
}

/** Modal do elenco: dados, séries com pôster e mini bio numa chamada. */
export const getTvmazePersonCard = (id: number): Promise<TvmazePersonCardDto> =>
  fetch(`/api/tvmaze/person/${encodeURIComponent(String(id))}/card`).then((r) => json<TvmazePersonCardDto>(r));

export const searchTvmazePeople = (q: string): Promise<{ results: TvmazePerson[] }> =>
  fetch(`/api/tvmaze/people/search?q=${encodeURIComponent(q)}`).then((r) => json<{ results: TvmazePerson[] }>(r));
