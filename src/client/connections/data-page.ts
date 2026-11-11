import { backupCardHtml, bindBackup } from './backup-card.ts';
import { renderLibraryIo } from '../library/library-io.ts';

/** Importar e backup: tudo que entra ou sai do banco local, num lugar só (antes vivia no fim de Conexões). */
export const renderData = (host: HTMLElement, query: URLSearchParams): void => {
  host.innerHTML = `
    <header class="view-head">
      <h1 class="view-title">Importar e backup</h1>
      <p class="view-subtitle">Leve sua lista para outro lugar ou traga de volta: backup completo em JSON, planilha CSV e lista do MyAnimeList. Nada sai deste computador.</p>
    </header>
    <div class="conn-grid">
      ${backupCardHtml()}
      <section class="conn-card" id="conn-library-io"></section>
    </div>`;
  const backup = host.querySelector('#conn-backup') as HTMLElement;
  bindBackup(backup);
  renderLibraryIo(host.querySelector('#conn-library-io') as HTMLElement);
  if (query.get('focus') === 'backup') backup.focus();
};
