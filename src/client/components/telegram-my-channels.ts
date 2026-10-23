import { addTelegramChannel, listMyTelegramChannels, type MyTelegramChannelDto } from '../api.ts';
import { icon } from '../icons.ts';
import { handleLabel, isPrivateHandle } from '../source-modes.ts';
import { showToast } from '../state.ts';
import { escapeHtml } from './card.ts';

const formatMembers = (n: number | null): string => (n === null ? '' : `${n.toLocaleString('pt-BR')} membros`);

/**
 * Diálogo "Meus canais": lista canais e grupos da conta pessoal (inclusive os privados, `c/<id>`) e importa os
 * marcados (um por vez, com progresso).
 */
export const openMyChannelsDialog = (onImported: () => void): void => {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog';
  dialog.setAttribute('closedby', 'any');
  dialog.setAttribute('aria-labelledby', 'my-channels-title');
  dialog.innerHTML = `
    <form method="dialog" class="dialog-head">
      <h2 id="my-channels-title">Meus canais do Telegram</h2>
      <button class="btn btn-ghost btn-sm" aria-label="fechar">${icon('x', 'sm')}</button>
    </form>
    <input type="search" class="input" id="mc-filter" placeholder="filtrar por nome ou @usuário" autocomplete="off" aria-label="filtrar canais" />
    <div id="mc-body" class="dialog-body" aria-live="polite"><p class="hint">carregando seus canais…</p></div>
    <div class="dialog-foot">
      <span class="hint" id="mc-count"></span>
      <button class="btn btn-primary btn-sm" id="mc-import" type="button" disabled>importar selecionados</button>
    </div>
  `;
  document.body.appendChild(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  // `closedby="any"` ainda não existe em todo navegador: clique no backdrop fecha via fallback.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.showModal();

  const body = dialog.querySelector('#mc-body') as HTMLElement;
  const filter = dialog.querySelector('#mc-filter') as HTMLInputElement;
  const countEl = dialog.querySelector('#mc-count') as HTMLElement;
  const importBtn = dialog.querySelector('#mc-import') as HTMLButtonElement;

  let channels: MyTelegramChannelDto[] = [];
  const picked = new Set<string>();
  let importing = false;

  const selectable = (ch: MyTelegramChannelDto): boolean => !ch.added;

  const syncFooter = () => {
    const total = channels.filter(selectable).length;
    countEl.textContent = `${picked.size} de ${total} selecionado${picked.size === 1 ? '' : 's'}`;
    importBtn.disabled = importing || picked.size === 0;
  };

  const render = () => {
    const q = filter.value.trim().toLowerCase();
    const visible = channels.filter((ch) => !q || ch.title.toLowerCase().includes(q) || ch.handle.toLowerCase().includes(q));
    if (visible.length === 0) {
      body.innerHTML = `<p class="hint">${channels.length === 0 ? 'você não participa de nenhum canal ou grupo.' : 'nenhum canal bate com o filtro.'}</p>`;
      syncFooter();
      return;
    }
    const allVisiblePicked = visible.filter(selectable).every((ch) => picked.has(ch.handle));
    body.innerHTML = `
      <label class="check-row check-all"><input type="checkbox" id="mc-all" ${allVisiblePicked && visible.some(selectable) ? 'checked' : ''} /> <span>selecionar todos os visíveis</span></label>
      ${visible
        .map((ch) => {
          const origin = isPrivateHandle(ch.handle) ? 'privado' : `@${ch.handle}`;
          const meta = [ch.added ? 'já adicionado' : origin, ch.kind === 'group' ? 'grupo' : '', formatMembers(ch.members)].filter(Boolean).join(' · ');
          const on = selectable(ch);
          return `<label class="check-row${on ? '' : ' is-disabled'}">
            <input type="checkbox" data-handle="${escapeHtml(ch.handle)}" ${on ? '' : 'disabled'} ${on && picked.has(ch.handle) ? 'checked' : ''} />
            <span class="check-text"><strong>${escapeHtml(ch.title)}</strong><small>${escapeHtml(meta)}</small></span>
          </label>`;
        })
        .join('')}
    `;
    syncFooter();
  };

  body.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.id === 'mc-all') {
      for (const ch of channels.filter(selectable)) {
        const q = filter.value.trim().toLowerCase();
        if (q && !ch.title.toLowerCase().includes(q) && !ch.handle.toLowerCase().includes(q)) continue;
        if (input.checked) picked.add(ch.handle);
        else picked.delete(ch.handle);
      }
      render();
      return;
    }
    const handle = input.dataset.handle;
    if (!handle) return;
    if (input.checked) picked.add(handle);
    else picked.delete(handle);
    syncFooter();
  });
  filter.addEventListener('input', render);

  importBtn.addEventListener('click', async () => {
    importing = true;
    const handles = [...picked];
    let ok = 0;
    for (const [i, handle] of handles.entries()) {
      importBtn.textContent = `importando ${i + 1}/${handles.length}…`;
      importBtn.disabled = true;
      try {
        await addTelegramChannel(handle, 'personal');
        ok++;
        picked.delete(handle);
        const ch = channels.find((c) => c.handle === handle);
        if (ch) ch.added = true;
      } catch (err) {
        const title = channels.find((c) => c.handle === handle)?.title;
        showToast(`${handleLabel(handle, title)}: ${err instanceof Error ? err.message : 'falhou'}`);
      }
    }
    importing = false;
    importBtn.textContent = 'importar selecionados';
    if (ok > 0) {
      showToast(`${ok} canal(is) importado(s)`);
      onImported();
    }
    render();
  });

  listMyTelegramChannels()
    .then((res) => {
      channels = res.channels;
      render();
    })
    .catch((err) => {
      body.innerHTML = `<p class="hint" style="color:var(--danger)">${escapeHtml(err instanceof Error ? err.message : 'não foi possível listar os canais')}</p>`;
    });
};
