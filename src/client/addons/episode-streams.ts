import type { TitleStreamsQuery } from '../api/stremio.ts';

/** `null` = ainda não dá para consultar (ex.: IMDb da TVmaze não chegou); o texto vira aviso no painel. */
export type StreamsQueryResolver = () => TitleStreamsQuery | { unavailable: string };
