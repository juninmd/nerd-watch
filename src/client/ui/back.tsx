/** Navegação de volta das telas de detalhe, com os componentes do Sonido. */
import { Button } from '@juninmd/sonido';
import type { MouseEvent } from 'react';
import { navigate } from '../app/router.ts';
import { Icon } from './icon.tsx';

/** Volta no histórico; se a aba começou nesta tela, vai para `fallback` em vez de sair do app. */
export function BackButton({ label = 'voltar', fallback = '/' }: { label?: string; fallback?: string }) {
  const back = () => {
    if (history.length > 1) history.back();
    else navigate(fallback);
  };
  return (
    <Button className="back-btn" variant="ghost" size="sm" iconStart={<Icon name="back" size="sm" />} onClick={back}>
      {label}
    </Button>
  );
}

/** Link de retorno no topo. `href` é o destino de reserva; com `useHistory` volta à tela de origem quando houver. */
export function BackLink({ href, label, useHistory = false }: { href: string; label: string; useHistory?: boolean }) {
  const onClick = (e: MouseEvent) => {
    if (!useHistory || history.length <= 1) return;
    e.preventDefault();
    history.back();
  };
  return (
    <a className="back-link" href={href} onClick={onClick}>
      <Icon name="back" size="sm" /> {label}
    </a>
  );
}
