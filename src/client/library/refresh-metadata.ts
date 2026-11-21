import { refreshTitleMetadata } from '../api/index.ts';
import { showToast } from '../app/state.ts';

/** Botão "Atualizar metadados" da página do título: busca de novo temporadas, episódios e datas na TMDB. */
export const renderRefreshMetadata = (titleId: string, onDone: () => void): HTMLElement => {
  const wrap = document.createElement('div');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-ghost btn-sm';
  btn.textContent = '🔄 Atualizar metadados';
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    btn.disabled = true;
    refreshTitleMetadata(titleId)
      .then((r) => {
        showToast(`metadados atualizados: ${r.seasons} temporada(s), ${r.episodes} episódio(s)`);
        if (wrap.isConnected) onDone();
      })
      .catch((err: unknown) => {
        showToast(err instanceof Error ? err.message : 'não foi possível atualizar');
        if (btn.isConnected) btn.disabled = false;
      });
  });

  wrap.appendChild(btn);
  return wrap;
};
