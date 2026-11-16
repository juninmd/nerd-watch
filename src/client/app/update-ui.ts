import { escapeHtml } from '../ui/card.ts';
import { checkForUpdate, installUpdate, updaterAvailable, type UpdateInfo } from '../platform/updater.ts';
import { progressLabel, progressPercent } from '../platform/update-model.ts';
import { showToast } from './state.ts';

/**
 * Cartão "Atualizações" (tela Ajustes): verifica, mostra a versão nova com as notas e, ao instalar,
 * uma barra de progresso real. O app só reinicia depois que a pessoa clica em "Atualizar agora".
 */
export const mountUpdateCard = (host: HTMLElement): void => {
  if (!updaterAvailable()) {
    host.innerHTML = '<p class="hint">Atualização automática só no app instalado (Windows). No navegador/Docker, atualize pelo repositório ou pela imagem.</p>';
    return;
  }
  const status = (html: string): void => {
    const el = host.querySelector('#upd-status');
    if (el) el.innerHTML = html;
  };
  host.innerHTML = `
    <p id="upd-status" class="hint" role="status" aria-live="polite">Clique em verificar para buscar a versão mais nova.</p>
    <div class="upd-bar" id="upd-bar" hidden><div class="upd-fill" id="upd-fill"></div></div>
    <div class="conn-actions"><button class="btn btn-ghost" id="upd-check" type="button">Verificar atualizações</button><button class="btn" id="upd-install" type="button" hidden>Atualizar agora</button></div>`;
  const checkBtn = host.querySelector('#upd-check') as HTMLButtonElement;
  const installBtn = host.querySelector('#upd-install') as HTMLButtonElement;
  const bar = host.querySelector('#upd-bar') as HTMLElement;
  const fill = host.querySelector('#upd-fill') as HTMLElement;

  const onFound = (info: UpdateInfo | null): void => {
    installBtn.hidden = !info;
    if (!info) {
      status('Você já está na versão mais nova.');
      return;
    }
    const notes = info.notes ? `<br>${escapeHtml(info.notes.slice(0, 400))}` : '';
    status(`<strong>v${escapeHtml(info.version)} disponível</strong> (instalada: v${escapeHtml(info.current)}).${notes}`);
  };

  const check = async (): Promise<void> => {
    checkBtn.disabled = true;
    status('Consultando a última release…');
    try {
      onFound(await checkForUpdate());
    } catch (err) {
      status(`Não foi possível verificar: ${escapeHtml(String(err))}`);
    } finally {
      checkBtn.disabled = false;
    }
  };

  checkBtn.addEventListener('click', () => void check());
  installBtn.addEventListener('click', async () => {
    installBtn.disabled = checkBtn.disabled = true;
    bar.hidden = false;
    status('Baixando a atualização…');
    try {
      await installUpdate(({ downloaded, total }) => {
        fill.style.width = `${progressPercent(downloaded, total) ?? 5}%`;
        status(`Baixando… ${progressLabel(downloaded, total)}`);
      });
      status('Instalado. Reiniciando o app…');
    } catch (err) {
      status(`Falha ao atualizar: ${escapeHtml(String(err))}`);
      installBtn.disabled = checkBtn.disabled = false;
    }
  });
  void check();
};

/** No boot do desktop: se há versão nova, avisa por toast com atalho para a tela de Ajustes. */
export const announceUpdateOnBoot = (): void => {
  if (!updaterAvailable()) return;
  void checkForUpdate()
    .then((info) => {
      if (info) showToast(`Versão v${info.version} disponível`, { label: 'Atualizar', run: () => { location.hash = '#/settings'; } });
    })
    .catch(() => undefined);
};
