import { Artwork, Card } from '@juninmd/sonido';

export interface ListCardProps {
  href: string;
  name: string;
  sub: string;
  label: string;
  covers: Array<string | null>;
}

/** Cartão com as primeiras capas da lista (mosaico); sem capa, um bloco com o gradiente da marca. */
export function ListCard({ href, name, sub, label, covers }: ListCardProps) {
  const shown = covers.slice(0, 4);
  return (
    <a className="list-card" href={href} aria-label={label}>
      <Card interactive padding="sm">
        <span className="list-mosaic" aria-hidden="true">
          {shown.length === 0 ? (
            <span className="list-cover empty" />
          ) : (
            shown.map((src, i) => (
              <Artwork key={i} className="list-cover" title={name} src={src ?? undefined} ratio="poster" />
            ))
          )}
        </span>
        <span className="list-name">{name}</span>
        <span className="list-sub">{sub}</span>
      </Card>
    </a>
  );
}
