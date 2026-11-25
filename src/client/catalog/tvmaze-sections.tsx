import { Artwork, Badge } from '@juninmd/sonido';
import type { TvmazeCrewMember, TvmazeEpisodeMeta, TvmazeImage, TvmazeMoreDto, TvmazePerson } from '../api/index.ts';
import { SideCard } from './side-card.tsx';
import {
  channelKind,
  episodeCodeOf,
  externalLinks,
  factsOf,
  groupCrew,
  showAgenda,
  stampLabel,
} from './tvmaze-view.ts';

/** Seções extras da ficha TVmaze (equipe, galeria, agenda, ficha técnica…). As regras ficam em `tvmaze-view.ts`. */

const personHref = (id: number): string => `#/person/tvmaze/${id}`;
const MAX_IMAGES = 18;
const IMAGE_TYPE_LABEL: Record<string, string> = {
  poster: 'pôsteres',
  banner: 'banners',
  background: 'fundos',
  typography: 'logotipos',
  other: 'outras',
};

export function PersonCard({
  person,
  line1,
  line2,
}: {
  person: TvmazePerson;
  line1: string | null;
  line2: string | null;
}) {
  return (
    <a className="tvm-person" href={personHref(person.id)} aria-label={person.name}>
      <Artwork title={person.name} src={person.imageUrl ?? undefined} ratio="poster" />
      <span className="tvm-person-name">{person.name}</span>
      {line1 && <span className="tvm-person-sub">{line1}</span>}
      {line2 && <span className="tvm-person-sub dim">{line2}</span>}
    </a>
  );
}

export function Crew({ crew }: { crew: TvmazeCrewMember[] }) {
  const groups = groupCrew(crew);
  if (groups.length === 0) return null;
  return (
    <>
      <div className="section-head">
        <h2>Equipe</h2>
      </div>
      <div className="tvm-crew">
        {groups.map((g) => (
          <div className="tvm-crew-row" key={g.role}>
            <h3>{g.role}</h3>
            <div className="tvm-chips">
              {g.people.map((p) => (
                <a className="tvm-chip" href={personHref(p.id)} key={p.id}>
                  {p.name}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Galeria por tipo: miniatura abre a imagem original em outra aba. */
export function Gallery({ images }: { images: TvmazeImage[] }) {
  if (images.length === 0) return null;
  return (
    <>
      <div className="section-head">
        <h2>Galeria</h2>
      </div>
      <div className="tvm-gallery">
        {images.slice(0, MAX_IMAGES).map((i) => (
          <a
            className={`tvm-shot ${i.type}`}
            href={i.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${IMAGE_TYPE_LABEL[i.type] ?? i.type}: abrir imagem original`}
            key={i.url}
          >
            <img src={i.thumbUrl} alt="" loading="lazy" decoding="async" />
          </a>
        ))}
      </div>
    </>
  );
}

function EpisodeLine({ label, e }: { label: string; e: TvmazeEpisodeMeta | null }) {
  if (!e) return null;
  return (
    <div className="tvm-next">
      <span className="tvm-next-label">{label}</span>
      <strong>
        {episodeCodeOf(e)} · {e.name}
      </strong>
      <span className="dim">
        {stampLabel(e)}
        {e.rating ? ` · ★ ${e.rating.toFixed(1)}` : ''}
      </span>
    </div>
  );
}

export function Agenda({ more }: { more: TvmazeMoreDto }) {
  if (!showAgenda(more)) return null;
  const empty = !more.nextEpisode && !more.previousEpisode;
  return (
    <SideCard title="Agenda">
      <EpisodeLine label="Próximo episódio" e={more.nextEpisode} />
      <EpisodeLine label="Último episódio" e={more.previousEpisode} />
      {empty && <p className="hint">sem próximo episódio anunciado</p>}
    </SideCard>
  );
}

export function Channels({ more }: { more: TvmazeMoreDto }) {
  if (more.channels.length === 0) return null;
  return (
    <SideCard title="Onde assistir">
      <div className="tvm-chips">
        {more.channels.map((c) => {
          const label = (
            <>
              {c.name}
              {c.country && <span className="dim"> ({c.country})</span>} · {channelKind(c)}
            </>
          );
          return c.url ? (
            <a className="tvm-chip" href={c.url} target="_blank" rel="noopener noreferrer" key={c.name}>
              {label}
            </a>
          ) : (
            <Badge key={c.name}>{label}</Badge>
          );
        })}
      </div>
    </SideCard>
  );
}

export function Facts({ more }: { more: TvmazeMoreDto }) {
  const rows = factsOf(more);
  if (rows.length === 0) return null;
  return (
    <SideCard title="Ficha técnica">
      <dl className="tvm-facts">
        {rows.map(([k, v]) => (
          <div className="tvm-fact" key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </SideCard>
  );
}

export function Akas({ more }: { more: TvmazeMoreDto }) {
  if (more.akas.length === 0) return null;
  return (
    <SideCard title="Títulos alternativos">
      <ul className="tvm-akas">
        {more.akas.map((a) => (
          <li key={`${a.name}:${a.country ?? ''}`}>
            {a.name}
            {a.country && <span className="dim"> · {a.country}</span>}
          </li>
        ))}
      </ul>
    </SideCard>
  );
}

export function ExternalLinks({ more }: { more: TvmazeMoreDto }) {
  const links = externalLinks(more);
  if (links.length === 0) return null;
  return (
    <div className="tvm-chips tvm-ext-links">
      {links.map(([name, url]) => (
        <a className="tvm-chip" href={url} target="_blank" rel="noopener noreferrer" key={name}>
          {name}
        </a>
      ))}
    </div>
  );
}
