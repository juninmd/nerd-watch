import { Button } from '@juninmd/sonido';
import { useRef, useState } from 'react';
import { exportBackup, importBackup } from '../api/index.ts';
import { showToast } from '../app/state.ts';
import { Icon } from '../ui/icon.tsx';
import { datedFileName } from '../ui/time-format.ts';
import { ConnCard } from './conn-card.tsx';

/** Backup completo em JSON: exportar baixa o arquivo; importar lê um arquivo escolhido. */
export function BackupCard() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    setExporting(true);
    try {
      const data = await exportBackup();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = datedFileName('nerd-watch-backup', 'json');
      a.click();
      URL.revokeObjectURL(url);
      showToast('backup exportado');
    } catch {
      showToast('falha ao exportar backup');
    } finally {
      setExporting(false);
    }
  };

  const doImport = async (input: HTMLInputElement) => {
    const picked = input.files?.[0];
    input.value = '';
    if (!picked) return;
    setImporting(true);
    try {
      const res = await importBackup(JSON.parse(await picked.text()));
      showToast(`backup importado: ${res.imported.titles} títulos, ${res.imported.libraryEntries} na lista`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'falha ao importar backup');
    } finally {
      setImporting(false);
    }
  };

  return (
    <ConnCard id="conn-backup" tabIndex={-1} icon="download" title="Backup" description="Sua lista, notas e canais num arquivo JSON. Tudo fica neste computador (data/nerd-watch.db).">
      <div className="conn-actions">
        <Button variant="ghost" iconStart={<Icon name="download" size="sm" />} loading={exporting} onClick={() => void doExport()}>
          Exportar backup
        </Button>
        <Button variant="ghost" iconStart={<Icon name="upload" size="sm" />} loading={importing} onClick={() => file.current?.click()}>
          Importar backup
        </Button>
        <input ref={file} type="file" accept="application/json" hidden onChange={(e) => void doImport(e.currentTarget)} />
      </div>
    </ConnCard>
  );
}
