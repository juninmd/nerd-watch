import { refreshTitleMetadata } from '../api.ts';
import { showToast } from '../state.ts';

/** Botão "Atualizar metadados" da página do título: busca de novo temporadas, episódios e datas na TMDB. */
export const renderRefreshMetadata = (titleId: string, onDone: () => void): HTMLElement => {
  const wrap = document.createElement('div');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-ghost btn-sm';
  btn.textContent = '🔄 Atualizar metadados';
  btn.addEventListener('click', () => {
    btn.disabled = true;
    refreshTitleMetadata(titleId)
      .then((r) => {
        showToast(`metadados atualizados: ${r.seasons} temporada(s), ${r.episodes} episódio(s)`);
        onDone();
      })
      .catch((err: unknown) => {
        showToast(err instanceof Error ? err.message : 'não foi possível atualizar');
        btn.disabled = false;
      });
  });

  wrap.appendChild(btn);
  return wrap;
};
