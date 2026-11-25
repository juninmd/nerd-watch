import { Button, Select } from '@juninmd/sonido';
import type { WatchStatus } from '../../server/types.ts';
import { Icon } from '../ui/icon.tsx';
import { BulkAddToList } from './library-bulk-lists.tsx';

const STATUS_OPTIONS = [
  { value: '', label: 'mudar status…' },
  { value: 'watching', label: 'Assistindo' },
  { value: 'want', label: 'Quero ver' },
  { value: 'watched', label: 'Assistido' },
  { value: 'dropped', label: 'Abandonado' },
];

export interface LibraryBulkBarProps {
  picked: string[];
  shown: number;
  busy: boolean;
  onToggleAll: () => void;
  onStatus: (status: WatchStatus) => void;
  onRemove: () => void;
}

/** Barra do modo seleção: contagem, todos/nenhum, mudar status, adicionar a lista e remover. */
export function LibraryBulkBar({ picked, shown, busy, onToggleAll, onStatus, onRemove }: LibraryBulkBarProps) {
  const none = picked.length === 0 || busy;
  return (
    <div className="toolbar">
      <span role="status">
        {picked.length} de {shown} selecionado{picked.length === 1 ? '' : 's'}
      </span>
      <Button variant="ghost" size="sm" onClick={onToggleAll}>
        {shown > 0 && picked.length === shown ? 'nenhum' : 'todos'}
      </Button>
      <Select
        label="Mudar status dos selecionados"
        options={STATUS_OPTIONS}
        value=""
        disabled={none}
        onChange={(v) => v && onStatus(v as WatchStatus)}
      />
      <BulkAddToList ids={picked} disabled={none} />
      <Button variant="danger" size="sm" iconStart={<Icon name="trash" size="sm" />} disabled={none} onClick={onRemove}>
        remover da lista
      </Button>
    </div>
  );
}
