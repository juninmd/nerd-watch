/** Telas de reserva da casca: rota inexistente e chunk que não baixou. */
import { Button, EmptyState } from '@juninmd/sonido';
import type { ReactNode } from 'react';
import { Icon } from '../ui/icon.tsx';

export const notFoundPage = (): ReactNode => (
  <EmptyState
    titleAs="h1"
    icon={<Icon name="search" />}
    title="página não encontrada"
    action={<a href="#/">voltar ao início</a>}
  />
);

/** Servidor parado ou rede caiu: a tela diz o que houve e oferece tentar de novo. */
export const loadErrorPage = (): ReactNode => (
  <EmptyState
    titleAs="h1"
    icon={<Icon name="alert" />}
    title="não foi possível carregar esta tela"
    action={
      <Button variant="ghost" size="sm" onClick={() => window.dispatchEvent(new HashChangeEvent('hashchange'))}>
        tentar de novo
      </Button>
    }
  />
);
