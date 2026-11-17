import { exportBackup, importBackup } from '../api/index.ts';
import { icon } from '../ui/icons.ts';
import { showToast } from '../app/state.ts';

export const backupCardHtml = (): string => `
  <section class="conn-card" id="conn-backup" tabindex="-1">
    <div class="conn-head">
      <span class="conn-ic">${icon('download')}</span>
      <div><h2>Backup</h2><p>Sua lista, notas e canais num arquivo JSON. Tudo fica neste computador (data/nerd-watch.db).</p></div>
    </div>
    <div class="conn-actions">
      <button class="btn btn-ghost" id="btn-export" type="button">${icon('download', 'sm')} Exportar backup</button>
      <button class="btn btn-ghost" id="btn-import" type="button">${icon('upload', 'sm')} Importar backup</button>
      <input type="file" accept="application/json" id="import-file" hidden />
    </div>
  </section>`;

export const bindBackup = (root: HTMLElement): void => {
  (root.querySelector('#btn-export') as HTMLButtonElement).addEventListener('click', async () => {
    try {
      const data = await exportBackup();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `nerd-watch-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('backup exportado');
    } catch {
      showToast('falha ao exportar backup');
    }
  });

  const input = root.querySelector('#import-file') as HTMLInputElement;
  (root.querySelector('#btn-import') as HTMLButtonElement).addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const res = await importBackup(JSON.parse(await file.text()));
      showToast(`backup importado: ${res.imported.titles} títulos, ${res.imported.libraryEntries} na lista`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'falha ao importar backup');
    }
  });
};
