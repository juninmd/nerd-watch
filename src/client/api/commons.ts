import { json } from './http.ts';

export interface CommonsVideoDto {
  title: string;
  name: string;
  thumbnailUrl: string | null;
  videoUrl: string;
  pageUrl: string;
  description: string;
  license: string;
  licenseUrl: string | null;
  author: string;
}

export const searchCommons = (q = ''): Promise<CommonsVideoDto[]> =>
  fetch(`/api/commons/search?q=${encodeURIComponent(q)}`).then((r) => json<{ results: CommonsVideoDto[] }>(r)).then((d) => d.results);

export const getCommonsVideo = (title: string): Promise<CommonsVideoDto> =>
  fetch(`/api/commons/file?title=${encodeURIComponent(title)}`).then((r) => json<CommonsVideoDto>(r));
