import { fetchAddonSubtitleVtt } from '../api/stremio.ts';
import type { AddonCaptionTrack, CaptionContext } from '../player/player-captions-model.ts';

/**
 * Legendas que o addon publica junto com o stream (`stream.subtitles`). O addon manda URL+idioma; o
 * menu do player só recebe id/label, e o download acontece quando o usuário escolhe a faixa — o
 * servidor reconsulta o addon e baixa com a barreira de host público (nunca é proxy aberto).
 */
export interface AddonSubtitleInput {
  id: string | null;
  lang: string;
}

export const addonCaptionTracks = (input: {
  addonId: string;
  type: string;
  contentId: string;
  streamIndex: number;
  subtitles?: readonly AddonSubtitleInput[];
}): AddonCaptionTrack[] =>
  (input.subtitles ?? []).map((track, subIndex) => ({
    id: `addon:${input.addonId}:${input.streamIndex}:${subIndex}`,
    label: track.lang && track.lang !== '?' ? track.lang : 'legenda do addon',
    detail: 'faixa publicada pelo addon',
    lang: track.lang && track.lang !== '?' ? track.lang : null,
    load: () => fetchAddonSubtitleVtt(input.addonId, input.type, input.contentId, input.streamIndex, subIndex),
  }));

/** Junta as faixas do addon ao contexto de legendas que a tela já montou (pode não existir). */
export const withAddonTracks = (ctx: CaptionContext | null, tracks: AddonCaptionTrack[]): CaptionContext | null => {
  if (tracks.length === 0) return ctx;
  return { ...(ctx ?? {}), addonTracks: [...(ctx?.addonTracks ?? []), ...tracks] };
};
