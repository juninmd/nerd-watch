/** Telas de reserva da casca: rota inexistente, chunk que não baixou e aparelho sem rede. */
import { Button, EmptyState } from '@juninmd/sonido';
import { type ReactNode, useEffect } from 'react';
import { Icon } from '../ui/icon.tsx';
import { useOnline } from './online-status.ts';

export const notFoundPage = (): ReactNode => (
  <EmptyState
    titleAs="h1"
    icon={<Icon name="search" />}
    title="página não encontrada"
    action={<a href="#/">voltar ao início</a>}
  />
);

const retry = (): void => {
  window.dispatchEvent(new HashChangeEvent('hashchange'));
};

/** Offline: explica o motivo e tenta sozinho quando a rede volta. Servidor parado: oferece tentar de novo. */
function LoadError() {
  const online = useOnline();
  useEffect(() => {
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, []);
  return (
    <EmptyState
      titleAs="h1"
      icon={<Icon name={online ? 'alert' : 'globe'} />}
      title={online ? 'não foi possível carregar esta tela' : 'você está sem internet'}
      description={
        online
          ? 'o servidor do nerd-watch pode estar parado.'
          : 'a biblioteca volta assim que a conexão voltar; esta tela recarrega sozinha.'
      }
      action={
        <Button variant="ghost" size="sm" onClick={retry}>
          tentar de novo
        </Button>
      }
    />
  );
}

export const loadErrorPage = (): ReactNode => <LoadError />;

/** Faixa fixa no topo enquanto o aparelho está sem rede: o que já abriu continua, o resto espera. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      <Icon name="globe" size="sm" /> Sem internet. O que já está aberto continua; o resto carrega quando a rede voltar.
    </div>
  );
}
