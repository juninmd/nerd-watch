import { Button } from '@juninmd/sonido';
import { useState } from 'react';
import { refreshTitleMetadata } from '../api/index.ts';
import { showToast } from '../app/state.ts';
import { Icon } from '../ui/icon.tsx';
import { useAlive } from './use-alive.ts';

/** Botão "Atualizar metadados" da página do título: busca de novo temporadas, episódios e datas na TMDB. */
export function RefreshMetadata({ titleId, onDone }: { titleId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const alive = useAlive();

  const refresh = () => {
    if (busy) return;
    setBusy(true);
    refreshTitleMetadata(titleId)
      .then((r) => {
        showToast(`metadados atualizados: ${r.seasons} temporada(s), ${r.episodes} episódio(s)`);
        if (alive.current) onDone();
      })
      .catch((err: unknown) => {
        showToast(err instanceof Error ? err.message : 'não foi possível atualizar');
        if (alive.current) setBusy(false);
      });
  };

  return (
    <Button variant="ghost" size="sm" iconStart={<Icon name="refresh" size="sm" />} loading={busy} onClick={refresh}>
      Atualizar metadados
    </Button>
  );
}
