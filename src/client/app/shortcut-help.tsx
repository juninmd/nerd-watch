import { Dialog, Kbd } from '@juninmd/sonido';
import { shortcutHelpRows } from './shortcut-keys.ts';

/** Ajuda de atalhos (`?`): a lista vem de `shortcutHelpRows`, a mesma fonte da navegação "g + letra". */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const rows = shortcutHelpRows(navigator.platform);
  return (
    <Dialog open onClose={onClose} title="Atalhos de teclado" className="help">
      <dl className="help-list">
        {rows.map(([keys, label]) => (
          <div key={keys}>
            <dt>
              <Kbd>{keys}</Kbd>
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
