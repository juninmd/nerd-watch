import { Badge, Card } from '@juninmd/sonido';
import type { ReactNode } from 'react';
import { Icon } from '../ui/icon.tsx';
import type { IconName } from '../ui/icons.ts';

export interface ConnStatus {
  ok: boolean;
  label: string;
}

interface ConnCardProps {
  icon: IconName;
  title: string;
  description: ReactNode;
  /** Selo de estado à direita (conectado, não configurado…); `undefined` = sem selo. */
  status?: ConnStatus;
  /** Ocupa a linha inteira da grade. */
  wide?: boolean;
  id?: string;
  tabIndex?: number;
  children?: ReactNode;
}

/** Cartão das centrais de Conexões, Importar e Credenciais: ícone, título, descrição, estado e o conteúdo. */
export function ConnCard({ icon, title, description, status, wide, id, tabIndex, children }: ConnCardProps) {
  return (
    <Card id={id} tabIndex={tabIndex} className={`conn-card${wide ? ' conn-wide' : ''}`} padding="lg">
      <div className="conn-head">
        <span className="conn-ic">
          <Icon name={icon} />
        </span>
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {status && (
          <Badge tone={status.ok ? 'success' : 'neutral'} dot>
            {status.label}
          </Badge>
        )}
      </div>
      {children && <div className="conn-body">{children}</div>}
    </Card>
  );
}
