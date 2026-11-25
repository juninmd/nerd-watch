import { type Command, CommandPalette } from '@juninmd/sonido';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../ui/icon.tsx';
import { catalogEntry, loadDataEntries, staticActions } from './palette-data.ts';
import { filterEntries, type PaletteEntry } from './palette-search.ts';

const GROUP_ICON = { Títulos: 'film', Canais: 'send', Ações: 'sliders', Catálogo: 'search' } as const;

const toCommand = (e: PaletteEntry): Command => ({
  id: e.id,
  label: e.title,
  group: e.group,
  icon: <Icon name={GROUP_ICON[e.group]} />,
  hint: e.keys ?? e.sub,
  keywords: e.sub,
  run: e.run,
});

const keepAll = (): boolean => true;

/** Paleta de comandos: biblioteca, canais e visões salvas (carregados ao abrir), ações fixas e busca no catálogo. */
export function PaletteDialog({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<PaletteEntry[]>([]);

  useEffect(() => {
    let alive = true;
    void loadDataEntries().then((entries) => {
      if (alive) setData(entries);
    });
    return () => {
      alive = false;
    };
  }, []);

  // filterEntries já filtra e ordena por relevância (e cria a entrada do catálogo): o filtro do Sonido deixa tudo passar.
  const commands = useCallback(
    (query: string) => {
      const q = query.trim();
      return filterEntries([...data, ...staticActions(), ...(q ? [catalogEntry(q)] : [])], q).map(toCommand);
    },
    [data],
  );

  return (
    <CommandPalette
      open
      onClose={onClose}
      commands={commands}
      filter={keepAll}
      placeholder="Buscar títulos, canais e ações…"
      emptyText="Nada encontrado. Tente outro termo."
    />
  );
}
