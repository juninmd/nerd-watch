import { Badge, Button, DataTable } from '@juninmd/sonido';
import { useState } from 'react';
import { compareTmdbTv, type SourceCompareDto } from '../api/index.ts';

type Row = SourceCompareDto['rows'][number];

/** Frase sob a tabela: concordam ou quantas divergências. Sem DOM: testável. */
export const compareSummary = (rows: Row[]): string => {
  const diffs = rows.filter((r) => r.differs).length;
  return diffs === 0
    ? 'As duas fontes concordam.'
    : `${diffs} ${diffs === 1 ? 'divergência' : 'divergências'} em destaque.`;
};

const COLUMNS = [
  {
    key: 'label',
    label: 'Campo',
    render: (r: Row) => (
      <>
        {r.label}{' '}
        {r.differs && (
          <Badge tone="warning" appearance="soft">
            diverge
          </Badge>
        )}
      </>
    ),
  },
  { key: 'tmdb', label: 'TMDB', render: (r: Row) => r.tmdb },
  { key: 'tvmaze', label: 'TVmaze', render: (r: Row) => r.tvmaze },
];

/** Tabela TMDB x TVmaze. Divergências em destaque; sem correspondência segura, diz isso em vez de chutar. */
function CompareTable({ d }: { d: SourceCompareDto }) {
  if (!d.match)
    return <p className="sc-note">Não achei esta série na TVmaze com segurança (nome e ano precisam bater).</p>;
  return (
    <>
      <DataTable label="Comparação TMDB e TVmaze" columns={COLUMNS} rows={d.rows} rowKey={(r) => r.field} />
      <p className="sc-note">
        {compareSummary(d.rows)} <a href={`#/title/tvmaze/tv/${encodeURIComponent(d.match.id)}`}>Abrir na TVmaze</a>
      </p>
    </>
  );
}

/** Botão sob demanda: a comparação faz uma busca extra na TVmaze, então só roda quando a pessoa pede. */
export function SourceCompare({ tmdbId }: { tmdbId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [data, setData] = useState<SourceCompareDto | null>(null);
  if (data) return <CompareTable d={data} />;
  const run = () => {
    setState('busy');
    compareTmdbTv(tmdbId)
      .then(setData)
      .catch(() => setState('failed'));
  };
  return (
    <Button variant="ghost" size="sm" loading={state === 'busy'} onClick={run}>
      {state === 'busy'
        ? 'Comparando…'
        : state === 'failed'
          ? 'Não deu certo. Tentar de novo'
          : 'Comparar com a TVmaze'}
    </Button>
  );
}
