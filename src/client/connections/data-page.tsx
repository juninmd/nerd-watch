import { PageHeader } from '@juninmd/sonido';

import { useEffect } from 'react';
import { LibraryIo } from '../library/library-io.tsx';
import { BackupCard } from './backup-card.tsx';

/** Importar e backup: tudo que entra ou sai do banco local, num lugar só (antes vivia no fim de Conexões). */
export function DataPage({ query }: { query: URLSearchParams }) {
  useEffect(() => {
    if (query.get('focus') === 'backup') document.getElementById('conn-backup')?.focus();
  }, [query]);
  return (
    <>
      <PageHeader titleAs="h1" title="Importar e backup" description="Leve sua lista para outro lugar ou traga de volta: backup completo em JSON, planilha CSV e lista do MyAnimeList. Nada sai deste computador." />
      <div className="conn-grid">
        <BackupCard />
        <LibraryIo />
      </div>
    </>
  );
}
