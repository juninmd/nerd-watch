import { exportLibraryCsv, importLibraryCsv, importMalList } from '../api.ts';
import { icon } from '../icons.ts';
import { csvReportLines, malReportLines, type ReportLines } from '../library-io-report.ts';
import { showToast } from '../state.ts';

const fileName = (): string => `nerd-watch-biblioteca-${new Date().toISOString().slice(0, 10)}.csv`;

/** Mostra o resumo e as linhas com erro. Texto via textContent: títulos vindos do arquivo nunca viram HTML. */
const showReport = (target: HTMLElement, lines: ReportLines): void => {
  target.replaceChildren();
  const summary = document.createElement('p');
  summary.textContent = lines.summary;
  target.append(summary);
  if (lines.note) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = lines.note;
    target.append(note);
  }
  if (lines.problems.length > 0) {
    const list = document.createElement('ul');
    list.className = 'conn-report-list';
    for (const text of lines.problems) {
      const item = document.createElement('li');
      item.textContent = text;
      list.append(item);
    }
    target.append(list);
  }
};

/** Lê o arquivo escolhido, manda ao servidor e mostra o relatório. Falha de rede ou de validação vira aviso, sem derrubar a tela. */
const bindImport = (input: HTMLInputElement, report: HTMLElement, run: (text: string) => Promise<ReportLines>, label: string): void => {
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    report.textContent = `${label}: importando…`;
    try {
      showReport(report, await run(await file.text()));
      showToast(`${label} concluído`);
    } catch (err) {
      report.textContent = err instanceof Error ? err.message : `falha ao importar ${label}`;
      showToast(`falha ao importar ${label}`);
    }
  });
};

/** Cartão de CSV e MAL da biblioteca: exportar, e importar o arquivo com o relatório de cada linha. */
export const renderLibraryIo = (host: HTMLElement): void => {
  host.innerHTML = `
    <div class="conn-head">
      <span class="conn-ic">${icon('list')}</span>
      <div><h2>Biblioteca em planilha</h2><p>Baixe sua lista como CSV para abrir no Excel, ou importe um CSV deste formato ou o XML exportado do MyAnimeList.</p></div>
    </div>
    <div class="conn-actions">
      <button class="btn btn-ghost" id="btn-lib-export" type="button">${icon('download', 'sm')} Baixar CSV</button>
      <button class="btn btn-ghost" id="btn-lib-csv" type="button">${icon('upload', 'sm')} Importar CSV</button>
      <button class="btn btn-ghost" id="btn-lib-mal" type="button">${icon('upload', 'sm')} Importar MAL (XML)</button>
      <input type="file" accept=".csv,text/csv" id="lib-csv-file" hidden />
      <input type="file" accept=".xml,text/xml,application/xml" id="lib-mal-file" hidden />
    </div>
    <div class="conn-report" role="status" aria-live="polite"></div>
  `;

  const report = host.querySelector('.conn-report') as HTMLElement;
  const csvInput = host.querySelector('#lib-csv-file') as HTMLInputElement;
  const malInput = host.querySelector('#lib-mal-file') as HTMLInputElement;

  (host.querySelector('#btn-lib-export') as HTMLButtonElement).addEventListener('click', async () => {
    try {
      const blob = await exportLibraryCsv();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName();
      a.click();
      URL.revokeObjectURL(url);
      showToast('CSV da biblioteca baixado');
    } catch {
      showToast('falha ao baixar o CSV');
    }
  });

  (host.querySelector('#btn-lib-csv') as HTMLButtonElement).addEventListener('click', () => csvInput.click());
  (host.querySelector('#btn-lib-mal') as HTMLButtonElement).addEventListener('click', () => malInput.click());
  bindImport(csvInput, report, async (text) => csvReportLines(await importLibraryCsv(text)), 'CSV');
  bindImport(malInput, report, async (xml) => malReportLines(await importMalList(xml)), 'MyAnimeList');
};
