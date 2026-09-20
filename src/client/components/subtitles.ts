import { downloadSubtitle, searchSubtitles, type SubtitleResultDto } from '../api.ts';
import { showToast } from '../state.ts';
import { escapeHtml } from './card.ts';

export interface SubtitlesPanelOptions {
  query?: string;
  tmdbId?: number;
}

const resultRow = (r: SubtitleResultDto): string => `
  <div class="episode-row" style="padding:10px 12px;margin-bottom:6px;align-items:center">
    <div class="body">
      <div class="head" style="margin-bottom:0">
        <span class="name" style="font-size:13px">${escapeHtml(r.language.toUpperCase())} · ${escapeHtml(r.release || r.fileName)}</span>
      </div>
      <div class="overview" style="font-size:11px">${r.downloadCount.toLocaleString('pt-BR')} downloads</div>
    </div>
    <button class="btn btn-ghost btn-sm" data-file-id="${r.fileId}">⬇️ baixar</button>
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
            Busca de legenda desligada — adicione <code>OPENSUBTITLES_API_KEY</code> no <code>.env</code>
            (grátis em <a href="https://www.opensubtitles.com/pt/consumers" target="_blank" rel="noopener noreferrer">opensubtitles.com</a>).
          </p>
        `;
        return;
      }
      if (data.results.length === 0) {
        wrap.innerHTML = `<p class="hint">nenhuma legenda encontrada para este título</p>`;
        return;
      }
      wrap.innerHTML = data.results.slice(0, 6).map(resultRow).join('');
      wrap.querySelectorAll<HTMLButtonElement>('[data-file-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const fileId = Number(btn.dataset.fileId);
          btn.textContent = '...';
          downloadSubtitle(fileId)
            .then((res) => {
              window.open(res.url, '_blank', 'noopener,noreferrer');
              showToast(`legenda baixada — ${res.remaining} downloads restantes hoje`);
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
