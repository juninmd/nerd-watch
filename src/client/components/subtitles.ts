import { downloadSubtitle, searchSubtitles, type SubtitleDownloadInput, type SubtitleResultDto } from '../api.ts';
import { icon } from '../icons.ts';
import { showToast } from '../state.ts';
import { escapeHtml } from './card.ts';

export interface SubtitlesPanelOptions {
  query?: string;
  tmdbId?: number;
  mediaType?: 'movie' | 'tv';
  season?: number | null;
  episode?: number | null;
}

/**
 * Monta o pedido de download. Os addons respondem por id do IMDb, então o `imdbId` que o servidor
 * devolveu na busca precisa voltar — sem ele o servidor não consegue reencontrar a legenda e o
 * painel levava 404 em todo download de addon.
 */
const downloadPayload = (
  result: SubtitleResultDto,
  opts: SubtitlesPanelOptions,
  imdbId: string | null,
): SubtitleDownloadInput => {
  if (result.fileId !== undefined) return { fileId: result.fileId };
  return {
    source: result.source,
    id: result.id,
    imdbId: imdbId ?? undefined,
    tmdbId: opts.tmdbId,
    mediaType: opts.mediaType,
    season: opts.season ?? null,
    episode: opts.episode ?? null,
  };
};

const resultRow = (r: SubtitleResultDto): string => `
  <div class="episode-row" style="padding:10px 12px;margin-bottom:6px;align-items:center">
    <div class="body">
      <div class="head" style="margin-bottom:0">
        <span class="name" style="font-size:13px">${escapeHtml(r.language)}</span>
      </div>
      <div class="overview" style="font-size:11px">${escapeHtml(r.release || 'release não informado')}</div>
      <div class="overview" style="font-size:11px">
        <span class="badge">${escapeHtml(r.source)}</span>
        ${r.downloads !== null ? ` ${r.downloads.toLocaleString('pt-BR')} downloads` : ''}
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" data-subtitle="${escapeHtml(r.id)}" data-source="${escapeHtml(r.source)}">${icon('download', 'sm')} baixar</button>
  </div>
`;

const disabledMessage = (reason: 'no_sources' | 'no_imdb_id' | undefined, unavailable: string[]): string => {
  if (reason === 'no_imdb_id') {
    return `
      <p class="hint">
        Não deu para identificar este título no IMDb, e as fontes de legenda respondem por id do IMDb.
        Isso acontece com título que a TMDB não vincula (e com o acervo do Internet Archive).
      </p>
    `;
  }
  return `
    <p class="hint">
      Busca de legenda desligada — adicione <code>SUBTITLE_ADDONS</code> no <code>.env</code>.
      O padrão (<code>https://opensubtitles-v3.strem.io</code>) é o addon OpenSubtitles do Stremio
      e <strong>não precisa de chave</strong>. A <code>OPENSUBTITLES_API_KEY</code> é opcional e
      só soma como segunda fonte.
      ${unavailable.length > 0 ? `<br />Fontes indisponíveis: ${escapeHtml(unavailable.join('; '))}` : ''}
    </p>
  `;
};

export const renderSubtitlesPanel = (opts: SubtitlesPanelOptions): HTMLElement => {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="skeleton" style="height:60px"></div>`;

  if (!opts.query && !opts.tmdbId) return wrap;

  searchSubtitles(opts)
    .then((data) => {
      if (!data.enabled) {
        wrap.innerHTML = disabledMessage(data.reason, data.unavailable);
        return;
      }
      if (data.results.length === 0) {
        wrap.innerHTML = `
          <p class="hint">nenhuma legenda encontrada para este título${
            data.unavailable.length > 0 ? ` (fontes indisponíveis: ${escapeHtml(data.unavailable.join('; '))})` : ''
          }</p>
        `;
        return;
      }

      const byKey = new Map(data.results.map((r) => [`${r.source}::${r.id}`, r]));
      wrap.innerHTML = data.results.slice(0, 8).map((r) => resultRow(r)).join('');

      wrap.querySelectorAll<HTMLButtonElement>('[data-subtitle]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const result = byKey.get(`${btn.dataset.source}::${btn.dataset.subtitle}`);
          if (!result) return;
          btn.textContent = '...';
          downloadSubtitle(downloadPayload(result, opts, data.imdbId))
            .then((res) => {
              window.open(res.url, '_blank', 'noopener,noreferrer');
              showToast(res.remaining === undefined ? 'legenda baixada' : `legenda baixada — ${res.remaining} downloads restantes hoje`);
              btn.innerHTML = `${icon('download', 'sm')} baixar`;
            })
            .catch(() => {
              showToast('não foi possível baixar essa legenda');
              btn.innerHTML = `${icon('download', 'sm')} baixar`;
            });
        });
      });
    })
    .catch(() => {
      wrap.innerHTML = `<p class="hint">não foi possível buscar legendas agora</p>`;
    });

  return wrap;
};
