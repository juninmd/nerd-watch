import { Avatar, Button, ProgressBar, ProgressRing } from '@juninmd/sonido';
import { useState } from 'react';
import type { TvmazeCastMember, TvmazeMoreDto } from '../api/index.ts';
import { pluralize } from '../ui/pluralize.ts';
import { SideCard } from './side-card.tsx';

/** Cartões novos da lateral da ficha (progresso, elenco compacto, temporadas). A conta fica em funções puras. */

export const CAST_PREVIEW = 6;

/** Porcentagem arredondada, nunca acima de 100%; `null` sem episódios (o cartão some). */
export const progressPct = (watched: number, total: number): number | null =>
  total > 0 ? Math.round((Math.min(watched, total) / total) * 100) : null;

export function ProgressCard({ watched, total, next }: { watched: number; total: number; next: string | null }) {
  const pct = progressPct(watched, total);
  if (pct === null) return null;
  return (
    <SideCard title="Seu progresso" className="prem-progress">
      <div className="prem-ring">
        <ProgressRing value={pct / 100} size={64} label={`${pct}% visto`}>
          <strong>{pct}%</strong>
        </ProgressRing>
        <span className="dim">
          {watched} de {pluralize(total, 'episódio', 'episódios')}
        </span>
      </div>
      {next && (
        <p className="prem-next">
          <span className="eyebrow">Próximo</span>
          {next}
        </p>
      )}
    </SideCard>
  );
}

const roleOf = (c: TvmazeCastMember): string => c.character?.name ?? (c.self ? 'ele(a) mesmo(a)' : '');

/** Elenco compacto: seis primeiros e "ver todos". Cada pessoa abre o modal com bio e outros trabalhos. */
export function CastCard({ cast, onPerson }: { cast: TvmazeCastMember[]; onPerson: (c: TvmazeCastMember) => void }) {
  const [open, setOpen] = useState(false);
  if (cast.length === 0) return null;
  const extra = cast.length - CAST_PREVIEW;
  const shown = open ? cast : cast.slice(0, CAST_PREVIEW);
  return (
    <SideCard
      className="prem-cast"
      title={
        <>
          Elenco <span className="dim">{cast.length}</span>
        </>
      }
    >
      <ul className="prem-cast-list" id="prem-cast-list">
        {shown.map((c) => {
          const role = roleOf(c);
          return (
            <li key={`${c.person.id}:${role}`}>
              <button
                type="button"
                aria-label={`${c.person.name}${role ? `, ${role}` : ''}: biografia e outros trabalhos`}
                onClick={() => onPerson(c)}
              >
                <Avatar name={c.person.name} src={c.person.imageUrl ?? undefined} size={42} />
                <span>
                  <strong>{c.person.name}</strong>
                  {role && (
                    <span className="dim">
                      {role}
                      {c.voice ? ' (voz)' : ''}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {extra > 0 && (
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={open}
          aria-controls="prem-cast-list"
          onClick={() => setOpen(!open)}
        >
          {open ? 'Mostrar menos' : `Ver elenco completo (+${extra})`}
        </Button>
      )}
    </SideCard>
  );
}

export interface SeasonRow {
  number: number;
  count: number;
  years: string;
  /** Proporção ao maior número de episódios, 0..1. */
  share: number;
}

/** Linhas da linha do tempo: contagem real quando houver; série de temporada única não mostra o cartão. */
export const seasonRows = (m: Pick<TvmazeMoreDto, 'seasons'>, counts: Map<number, number>): SeasonRow[] => {
  const countOf = (s: TvmazeMoreDto['seasons'][number]) => counts.get(s.number) ?? s.episodeOrder ?? 0;
  const rows = m.seasons.filter((s) => s.number > 0 && countOf(s) > 0);
  if (rows.length < 2) return [];
  const max = Math.max(...rows.map(countOf));
  return rows.map((s) => ({
    number: s.number,
    count: countOf(s),
    years: [s.premiereDate?.slice(0, 4), s.endDate?.slice(2, 4)].filter(Boolean).join('–'),
    share: countOf(s) / max,
  }));
};

/** Linha do tempo das temporadas: barra proporcional ao maior número de episódios; clique leva à aba. */
export function SeasonsCard({ rows, onJump }: { rows: SeasonRow[]; onJump: (season: number) => void }) {
  if (rows.length === 0) return null;
  return (
    <SideCard title="Temporadas" className="prem-seasons">
      <ol>
        {rows.map((s) => (
          <li key={s.number}>
            <button type="button" aria-label={`Ir para a temporada ${s.number}`} onClick={() => onJump(s.number)}>
              <span className="mono">T{s.number}</span>
              <ProgressBar value={s.share} label={`${s.count} episódios`} size="sm" />
              <span className="dim mono">
                {s.count} ep{s.years ? ` · ${s.years}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </SideCard>
  );
}
