import { type Command, CommandPalette } from '@juninmd/sonido';
import { useEffect, useMemo, useState } from 'react';
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
  // O Sonido filtra por rótulo + grupo + keywords: com o `sub` aqui, o que filterEntries achou pelo subtítulo continua na lista.
  keywords: e.sub,
  run: e.run,
});

/** Paleta de comandos: biblioteca, canais e visões salvas (carregados ao abrir), ações fixas e busca no catálogo. */
export function PaletteDialog({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<PaletteEntry[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    void loadDataEntries().then((entries) => {
      if (alive) setData(entries);
    });
    return () => {
      alive = false;
    };
  }, []);

  const commands = useMemo(() => {
    const q = query.trim();
    return filterEntries([...data, ...staticActions(), ...(q ? [catalogEntry(q)] : [])], q).map(toCommand);
  }, [data, query]);

  return (
    // A paleta do Sonido guarda o texto por dentro; o `input` sobe até aqui e alimenta a relevância e a entrada do catálogo.
    <div className="palette-host" onInput={(e) => setQuery((e.target as HTMLInputElement).value)}>
      <CommandPalette
        open
        onClose={onClose}
        commands={commands}
        placeholder="Buscar títulos, canais e ações…"
        emptyText="Nada encontrado. Tente outro termo."
      />
    </div>
  );
}
