import { Button, Dialog, Switch } from '@juninmd/sonido';
import { useState } from 'react';
import type { AddonBoardDto } from '../api/stremio.ts';
import { openOverlay } from '../ui/overlay.tsx';
import { arrangeBoards, type CatalogPrefs, moveBoard, toggleHidden } from './catalog-prefs.ts';

interface ManagerProps {
  boards: AddonBoardDto[];
  prefs: CatalogPrefs;
  onChange: (p: CatalogPrefs) => void;
}

/** Ordena com setas (teclado e toque, sem arrastar), esconde com Switch e liga o feed combinado. */
function CatalogManager({ boards, prefs: initial, onChange, onClose }: ManagerProps & { onClose: () => void }) {
  const [prefs, setPrefs] = useState(initial);
  const update = (p: CatalogPrefs) => {
    setPrefs(p);
    onChange(p);
  };
  const list = arrangeBoards(boards, prefs);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Gerenciar catálogos"
      description="A ordem e o que fica oculto valem só neste navegador."
      footer={
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      <Switch
        checked={prefs.feed}
        onChange={(feed) => update({ ...prefs, feed })}
        label="Meu feed"
        description="Um trilho no topo que mistura os catálogos visíveis."
      />
      <ol className="catalog-manager">
        {list.map((b, i) => {
          const name = `${b.addonName} · ${b.name}`;
          return (
            <li key={b.key} className="catalog-manager__row">
              <span className="catalog-manager__name">{name}</span>
              <Button variant="ghost" size="sm" aria-label={`Subir ${name}`} disabled={i === 0} onClick={() => update(moveBoard(boards, prefs, b.key, -1))}>
                ↑
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Descer ${name}`}
                disabled={i === list.length - 1}
                onClick={() => update(moveBoard(boards, prefs, b.key, 1))}
              >
                ↓
              </Button>
              <Switch checked={!prefs.hidden.includes(b.key)} onChange={(on) => update(toggleHidden(prefs, b.key, !on))} label="Visível" />
            </li>
          );
        })}
      </ol>
    </Dialog>
  );
}

export const openCatalogManager = (props: ManagerProps): void => {
  openOverlay((close) => <CatalogManager {...props} onClose={close} />);
};
