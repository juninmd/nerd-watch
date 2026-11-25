import { Button, Checkbox, Dialog, SearchField } from '@juninmd/sonido';
import { useEffect, useRef, useState } from 'react';
import { addTelegramChannel, listMyTelegramChannels, type MyTelegramChannelDto } from '../api/index.ts';
import { showToast } from '../app/state.ts';
import { handleLabel, isPrivateHandle } from '../connections/source-modes.ts';
import { openDialog } from './open-dialog.tsx';

const formatMembers = (n: number | null): string => (n === null ? '' : `${n.toLocaleString('pt-BR')} membros`);

const matchesFilter = (ch: MyTelegramChannelDto, q: string): boolean => !q || ch.title.toLowerCase().includes(q) || ch.handle.toLowerCase().includes(q);

function MyChannelsDialog({ onImported, onClose }: { onImported: () => void; onClose: () => void }) {
  const [channels, setChannels] = useState<MyTelegramChannelDto[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [progress, setProgress] = useState<string | null>(null);
  const open = useRef(true);

  useEffect(() => {
    listMyTelegramChannels()
      .then((res) => {
        if (open.current) setChannels(res.channels);
      })
      .catch((err) => {
        if (open.current) setError(err instanceof Error ? err.message : 'não foi possível listar os canais');
      });
    return () => {
      open.current = false;
    };
  }, []);

  const all = channels ?? [];
  const selectable = all.filter((ch) => !ch.added);
  const q = filter.trim().toLowerCase();
  const visible = all.filter((ch) => matchesFilter(ch, q));
  const visibleSelectable = visible.filter((ch) => !ch.added);
  const allVisiblePicked = visibleSelectable.length > 0 && visibleSelectable.every((ch) => picked.has(ch.handle));

  const toggle = (handles: string[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const h of handles) {
        if (on) next.add(h);
        else next.delete(h);
      }
      return next;
    });

  /** Importa um por vez, com progresso; falha em um canal não interrompe os outros. */
  const importPicked = async () => {
    const handles = [...picked];
    let ok = 0;
    for (const [i, handle] of handles.entries()) {
      if (!open.current) break;
      setProgress(`importando ${i + 1}/${handles.length}…`);
      try {
        await addTelegramChannel(handle, 'personal');
        ok++;
        toggle([handle], false);
        setChannels((list) => list?.map((c) => (c.handle === handle ? { ...c, added: true } : c)) ?? null);
      } catch (err) {
        const title = all.find((c) => c.handle === handle)?.title;
        showToast(`${handleLabel(handle, title)}: ${err instanceof Error ? err.message : 'falhou'}`);
      }
    }
    setProgress(null);
    if (ok > 0) {
      showToast(`${ok} canal(is) importado(s)`);
      onImported();
    }
  };

  const footer = (
    <>
      <span className="hint">
        {picked.size} de {selectable.length} selecionado{picked.size === 1 ? '' : 's'}
      </span>
      <Button variant="primary" size="sm" disabled={progress !== null || picked.size === 0} onClick={() => void importPicked()}>
        {progress ?? 'importar selecionados'}
      </Button>
    </>
  );

  return (
    <Dialog open onClose={onClose} title="Meus canais do Telegram" footer={footer}>
      <SearchField label="filtrar canais" placeholder="filtrar por nome ou @usuário" autoComplete="off" value={filter} onChange={setFilter} />
      <div className="dialog-body" aria-live="polite">
        {error ? (
          <p className="hint" role="alert">
            {error}
          </p>
        ) : channels === null ? (
          <p className="hint">carregando seus canais…</p>
        ) : visible.length === 0 ? (
          <p className="hint">{all.length === 0 ? 'você não participa de nenhum canal ou grupo.' : 'nenhum canal bate com o filtro.'}</p>
        ) : (
          <>
            <Checkbox
              label="selecionar todos os visíveis"
              checked={allVisiblePicked}
              onChange={(on) =>
                toggle(
                  visibleSelectable.map((ch) => ch.handle),
                  on,
                )
              }
            />
            {visible.map((ch) => {
              const origin = isPrivateHandle(ch.handle) ? 'privado' : `@${ch.handle}`;
              const meta = [ch.added ? 'já adicionado' : origin, ch.kind === 'group' ? 'grupo' : '', formatMembers(ch.members)].filter(Boolean).join(' · ');
              return <Checkbox key={ch.handle} label={ch.title} description={meta} disabled={ch.added} checked={!ch.added && picked.has(ch.handle)} onChange={(on) => toggle([ch.handle], on)} />;
            })}
          </>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Diálogo "Meus canais": lista canais e grupos da conta pessoal (inclusive os privados, `c/<id>`) e importa os
 * marcados. O foco volta a quem abriu ao fechar.
 */
export const openMyChannelsDialog = (onImported: () => void): void => openDialog((close) => <MyChannelsDialog onImported={onImported} onClose={close} />);
