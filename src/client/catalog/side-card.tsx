import { Button, Card } from '@juninmd/sonido';
import type { ReactNode } from 'react';
import type { IconName } from '../ui/icons.ts';
import { Icon } from '../ui/icon.tsx';

/** Cartão da coluna lateral das fichas: Card do Sonido com o título da seção. */
export function SideCard({
  title,
  className,
  children,
}: {
  title?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={`side-card${className ? ` ${className}` : ''}`} padding="none">
      {title && <h3>{title}</h3>}
      {children}
    </Card>
  );
}

/**
 * Link externo com a cara do Button do Sonido. O Button não aceita `href` e botão dentro de `<a>` é HTML inválido,
 * então o `<a>` usa as classes do próprio Sonido.
 */
export function LinkButton({
  href,
  icon,
  variant = 'ghost',
  block = false,
  download = false,
  children,
}: {
  href: string;
  icon?: IconName;
  variant?: 'primary' | 'ghost';
  block?: boolean;
  download?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      variant={variant}
      size="sm"
      className={block ? 'link-button--block' : undefined}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      download={download || undefined}
      iconStart={icon && <Icon name={icon} size="sm" />}
    >
      {children}
    </Button>
  );
}
