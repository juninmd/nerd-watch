import { type IconName, iconPaths } from './icons.ts';

/** Ícone de traço (24x24, `currentColor`) do app, para usar direto ou como `icon` dos componentes do Sonido. */
export function Icon({ name, size }: { name: IconName; size?: 'sm' }) {
  return (
    <svg
      className={size ? `i ${size}` : 'i'}
      viewBox="0 0 24 24"
      aria-hidden="true"
      // Seguro: traços SVG constantes de icons.ts, nunca dado externo.
      dangerouslySetInnerHTML={{ __html: iconPaths(name) }}
    />
  );
}
