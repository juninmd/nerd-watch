import { downloadSubtitle, searchSubtitles, type SubtitleDownloadInput, type SubtitleResultDto } from '../api.ts';
import { showToast } from '../state.ts';
import { escapeHtml } from './card.ts';

export interface SubtitlesPanelOptions {
  query?: string;
  tmdbId?: number;
  mediaType?: 'movie' | 'tv';
  season?: number | null;
  episode?: number | null;
}

const downloadPayload = (result: SubtitleResultDto, opts: SubtitlesPanelOptions): SubtitleDownloadInput => {
  if (result.fileId !== undefined) return { fileId: result.fileId };
  return {
    source: result.source,
    id: result.id,
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
    <button class="btn btn-ghost btn-sm" data-subtitle="${escapeHtml(r.id)}" data-source="${escapeHtml(r.source)}">⬇️ baixar</button>
  </div>
`;

export const renderSubtitlesPanel = (opts: SubtitlesPanelOptions): HTMLElement => {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="skeleton" style="height:60px"></div>`;

  if (!opts.query && !opts.tmdbId) return wrap;

  searchSubtitles(opts)
    .then((data) => {
      if (!data.enabled) {
        wrap.innerHTML = `
          <p class="hint">
            Busca de legenda desligada — adicione <code>SUBTITLE_ADDONS</code> no <code>.env</code>.
            O padrão (<code>https://opensubtitles-v3.strem.io</code>) é o addon OpenSubtitles do Stremio
            e <strong>não precisa de chave</strong>. A <code>OPENSUBTITLES_API_KEY</code> é opcional e
            só soma como segunda fonte.
          </p>
        `;
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

      const byId = new Map(data.results.map((r) => [`${r.source}::${r.id}`, r]));
      wrap.innerHTML = data.results.slice(0, 8).map((r) => resultRow(r)).join('');

      wrap.querySelectorAll<HTMLButtonElement>('[data-subtitle]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = `${btn.dataset.source}::${btn.dataset.subtitle}`;
          const result = byId.get(key);
          if (!result) return;
          btn.textContent = '...';
          downloadSubtitle(downloadPayload(result, opts))
            .then((res) => {
              window.open(res.url, '_blank', 'noopener,noreferrer');
              showToast(res.remaining === undefined ? 'legenda baixada' : `legenda baixada — ${res.remaining} downloads restantes hoje`);
              btn.textContent = '⬇️ baixar';
            })
            .catch(() => {
              showToast('não foi possível baixar essa legenda');
              btn.textContent = '⬇️ baixar';
            });
        });
      });
    })
    .catch(() => {
      wrap.innerHTML = `<p class="hint">não foi possível buscar legendas agora</p>`;
    });

  return wrap;
};
