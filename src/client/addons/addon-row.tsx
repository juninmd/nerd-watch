import { Artwork, Badge, Button, ConfirmButton, Tooltip } from '@juninmd/sonido';
import { useEffect, useState } from 'react';
import { type AddonDto, getAddonStatus, removeAddon, setAddonEnabled } from '../api/stremio.ts';
import { navigate } from '../app/router.ts';
import { showToast } from '../app/state.ts';
import { Icon } from '../ui/icon.tsx';
import { addonPath, canBrowse, capabilitySummary, resourceLabel } from './addon-links.ts';

const useStatus = (id: string): string => {
  const [status, setStatus] = useState('verificando…');
  useEffect(() => {
    let alive = true;
    getAddonStatus(id)
      .then((s) => {
        if (alive) setStatus(s.ok ? 'status: respondendo' : `status: erro — ${s.error ?? 'sem resposta'}`);
      })
      .catch(() => {
        if (alive) setStatus('status: não foi possível verificar');
      });
    return () => {
      alive = false;
    };
  }, [id]);
  return status;
};

/** Um addon instalado: o que entrega, se responde, e as ações de explorar, ligar/desligar e remover. */
export function AddonRow({ addon: a, onChanged }: { addon: AddonDto; onChanged: () => void }) {
  const status = useStatus(a.id);
  const [busy, setBusy] = useState(false);

  const toggle = () => {
    setBusy(true);
    setAddonEnabled(a.id, !a.enabled)
      .then((updated) => {
        showToast(updated.enabled ? `"${updated.name}" ligado de novo` : `"${updated.name}" desligado: não entra em título, busca nem quadros`);
        onChanged();
      })
      .catch(() => showToast('Não foi possível mudar o addon agora'))
      .finally(() => setBusy(false));
  };

  const remove = () => {
    setBusy(true);
    removeAddon(a.id)
      .then(onChanged)
      .catch(() => {
        setBusy(false);
        showToast('Não foi possível remover o addon');
      });
  };

  return (
    <li className={`addon-row${a.enabled ? '' : ' addon-off'}`}>
      <div className="addon-logo" aria-hidden="true">
        {a.logo ? <Artwork ratio="square" title={a.name} src={a.logo} referrerPolicy="no-referrer" /> : <Icon name="plug" />}
      </div>
      <div className="addon-body">
        <h3>
          {a.name} {a.version && <small>v{a.version}</small>} {!a.enabled && <Badge tone="neutral">desligado</Badge>}
        </h3>
        <p className="hint">{a.host}</p>
        {a.description && <p className="addon-desc">{a.description}</p>}
        <p className="hint addon-summary">{capabilitySummary(a)}</p>
        <p className="hint addon-status">{status}</p>
        <div className="chip-row">
          {a.resources.map((r) => (
            <Badge key={r} tone="neutral">
              {resourceLabel(r)}
            </Badge>
          ))}
        </div>
      </div>
      <div className="addon-actions">
        {canBrowse(a) && (
          <Button size="sm" onClick={() => navigate(addonPath(a.id))}>
            explorar
          </Button>
        )}
        <Tooltip content={a.enabled ? 'desligar: para de ser consultado nos títulos, busca e quadros' : 'ligar de novo'}>
          <Button variant="ghost" size="sm" aria-pressed={a.enabled} disabled={busy} iconStart={<Icon name="power" size="sm" />} onClick={toggle}>
            {a.enabled ? 'ligado' : 'desligado'}
          </Button>
        </Tooltip>
        <ConfirmButton
          variant="ghost"
          size="sm"
          disabled={busy}
          aria-label={`remover ${a.name}`}
          iconStart={<Icon name="trash" size="sm" />}
          ask={`Remover o addon "${a.name}"? Nada do seu histórico muda; para voltar a usar, cole o link de novo.`}
          confirmLabel="remover"
          cancelLabel="cancelar"
          onConfirm={remove}
        >
          remover
        </ConfirmButton>
      </div>
    </li>
  );
}
