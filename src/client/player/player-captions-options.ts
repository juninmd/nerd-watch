import { fetchSubtitleVtt, type SubtitleResultDto } from '../api/index.ts';
import { decodeSubtitleBytes } from '../../shared/subtitles/decode.ts';
import { toWebVtt } from '../../shared/subtitles/srt-vtt.ts';
import { ARCHIVE_OPTION, type CaptionContext, languageOption } from './player-captions-model.ts';

/** Uma escolha no menu: de onde vem a legenda e como carregá-la em WebVTT. */
export interface CaptionOption {
  id: string;
  label: string;
  detail: string;
  /** Código do idioma (guardado como preferência). Null quando não é idioma de busca. */
  code: string | null;
  load(): Promise<string>;
}

export const DISABLED_TEXT: Record<string, string> = {
  no_sources: 'Busca de legenda desligada neste servidor.',
  no_imdb_id: 'Não achamos o IMDb deste título, e as fontes de legenda pedem esse id.',
};

export const localFailure = (reason: 'empty' | 'no_cues'): string =>
  reason === 'empty' ? 'o arquivo está vazio' : 'não achamos linhas de legenda neste arquivo';

/** Mesmo teto do servidor: arquivo maior que isso não é legenda de filme. */
const LOCAL_MAX_BYTES = 2 * 1024 * 1024;

/** Arquivo escolhido ou arrastado pelo usuário, convertido para WebVTT; a falha já vem com a frase para mostrar. */
export const readLocalCaption = async (file: File): Promise<{ ok: true; vtt: string } | { ok: false; message: string }> => {
  if (file.size > LOCAL_MAX_BYTES) return { ok: false, message: 'arquivo grande demais para legenda (limite de 2 MB)' };
  try {
    const converted = toWebVtt(decodeSubtitleBytes(new Uint8Array(await file.arrayBuffer())));
    if (!converted.ok) return { ok: false, message: `não foi possível usar este arquivo: ${localFailure(converted.reason)}` };
    return { ok: true, vtt: converted.vtt };
  } catch {
    return { ok: false, message: 'não foi possível ler este arquivo' };
  }
};

/** Mensagem de erro do servidor é texto fixo; o resto cai numa frase genérica. */
export const errorText = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : 'não foi possível carregar a legenda';

/** Uma opção por idioma da busca. O download é pelo id da fonte, e o servidor reencontra a URL. */
export const resultOption = (r: SubtitleResultDto, imdbId: string | null, forCtx: CaptionContext): CaptionOption => ({
  id: languageOption(r.languageCode),
  label: r.language,
  detail: r.release || r.source,
  code: r.languageCode,
  load: () =>
    fetchSubtitleVtt(
      r.fileId !== undefined
        ? { fileId: r.fileId }
        : {
            source: r.source,
            id: r.id,
            imdbId: imdbId ?? undefined,
            tmdbId: forCtx.tmdbId,
            mediaType: forCtx.mediaType,
            season: forCtx.season ?? null,
            episode: forCtx.episode ?? null,
          },
    ),
});

/** Legenda que o próprio Internet Archive hospeda para o item. */
export const archiveOption = (identifier: string): CaptionOption => ({
  id: ARCHIVE_OPTION,
  label: 'Internet Archive',
  detail: 'legenda do próprio arquivo',
  code: null,
  load: () => fetchSubtitleVtt({ archiveId: identifier }),
});
