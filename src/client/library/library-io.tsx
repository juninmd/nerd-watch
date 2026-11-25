import { Button, Card } from '@juninmd/sonido';
import { type ChangeEvent, useRef, useState } from 'react';
import { exportLibraryCsv, importLibraryCsv, importMalList } from '../api/index.ts';
import { showToast } from '../app/state.ts';
import { Icon } from '../ui/icon.tsx';
import { datedFileName } from '../ui/time-format.ts';
import { csvReportLines, malReportLines, type ReportLines } from './library-io-report.ts';
import { useAlive } from './use-alive.ts';

type Report = { text: string } | { lines: ReportLines } | null;
type Busy = 'export' | 'csv' | 'mal' | null;

/** Resumo e linhas com erro. Texto em JSX: títulos vindos do arquivo nunca viram HTML. */
function ReportView({ report }: { report: Report }) {
  if (!report) return null;
  if ('text' in report) return <>{report.text}</>;
  const { summary, note, problems } = report.lines;
  return (
    <>
      <p>{summary}</p>
      {note && <p className="hint">{note}</p>}
      {problems.length > 0 && (
        <ul className="conn-report-list">
          {problems.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Cartão (próprio, dentro da grade de conexões) de CSV e MAL da biblioteca: exportar, e importar o arquivo com o relatório de cada linha. */
export function LibraryIo() {
  const [busy, setBusy] = useState<Busy>(null);
  const [report, setReport] = useState<Report>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const malInput = useRef<HTMLInputElement>(null);
  const alive = useAlive();

  const download = async () => {
    if (busy) return;
    setBusy('export');
    try {
      const url = URL.createObjectURL(await exportLibraryCsv());
      const a = document.createElement('a');
      a.href = url;
      a.download = datedFileName('nerd-watch-biblioteca', 'csv');
      a.click();
      URL.revokeObjectURL(url);
      showToast('CSV da biblioteca baixado');
    } catch {
      showToast('falha ao baixar o CSV');
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  /** Lê o arquivo escolhido, manda ao servidor e mostra o relatório. Falha vira aviso, sem derrubar a tela. */
  const importFile =
    (kind: 'csv' | 'mal', label: string, run: (text: string) => Promise<ReportLines>) =>
    async (e: ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      const file = input.files?.[0];
      input.value = '';
      if (!file || busy) return;
      setBusy(kind);
      setReport({ text: `${label}: importando…` });
      try {
        const lines = await run(await file.text());
        if (!alive.current) return;
        setReport({ lines });
        showToast(`${label} concluído`);
      } catch (err) {
        if (!alive.current) return;
        setReport({ text: err instanceof Error ? err.message : `falha ao importar ${label}` });
        showToast(`falha ao importar ${label}`);
      } finally {
        if (alive.current) setBusy(null);
      }
    };

  return (
    <Card className="conn-card" id="conn-library-io" padding="lg">
      <div className="conn-head">
        <span className="conn-ic">
          <Icon name="list" />
        </span>
        <div>
          <h2>Biblioteca em planilha</h2>
          <p>
            Baixe sua lista como CSV para abrir no Excel, ou importe um CSV deste formato ou o XML exportado do
            MyAnimeList.
          </p>
        </div>
      </div>
      <div className="conn-actions">
        <Button
          variant="ghost"
          iconStart={<Icon name="download" size="sm" />}
          loading={busy === 'export'}
          onClick={download}
        >
          Baixar CSV
        </Button>
        <Button
          variant="ghost"
          iconStart={<Icon name="upload" size="sm" />}
          loading={busy === 'csv'}
          onClick={() => csvInput.current?.click()}
        >
          Importar CSV
        </Button>
        <Button
          variant="ghost"
          iconStart={<Icon name="upload" size="sm" />}
          loading={busy === 'mal'}
          onClick={() => malInput.current?.click()}
        >
          Importar MAL (XML)
        </Button>
        <input
          ref={csvInput}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={importFile('csv', 'CSV', async (text) => csvReportLines(await importLibraryCsv(text)))}
        />
        <input
          ref={malInput}
          type="file"
          accept=".xml,text/xml,application/xml"
          hidden
          onChange={importFile('mal', 'MyAnimeList', async (xml) => malReportLines(await importMalList(xml)))}
        />
      </div>
      <div className="conn-report" role="status" aria-live="polite">
        <ReportView report={report} />
      </div>
    </Card>
  );
}
