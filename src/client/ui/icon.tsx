import { type IconName, iconPaths } from './icons.ts';

/** Versão React de `icon()`: mesmo desenho e classes, para passar como `icon` aos componentes do Sonido. */
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
