import type { StatsSummary } from '../../server/stats/summary.ts';
import { Card } from '@juninmd/sonido';
import { Icon } from '../ui/icon.tsx';
import { libraryParts } from './insights.ts';
import { backlogView, formatCount, formatHours, plural } from './model.ts';
import { SegmentedBar } from './stat-marks.tsx';
import { NumbersTable } from './stats-figures.tsx';

/** Biblioteca (composição por status e tempo estimado) e a fila "quero ver" com a data prevista de término. */
export function LibraryCards({ s }: { s: StatsSummary }) {
  const lib = s.library;
  const wt = lib.watchTime;
  const b = backlogView(s);
  const parts = libraryParts(s);
  const missing =
    wt.missingTitles > 0 || wt.episodesWithoutRuntime > 0
      ? `${formatCount(wt.missingTitles)} ${plural(wt.missingTitles, 'título', 'títulos')} sem duração e ${formatCount(wt.episodesWithoutRuntime)} ${plural(wt.episodesWithoutRuntime, 'episódio', 'episódios')} sem duração ficaram de fora.`
      : 'Duração completa para todos os assistidos.';
  return (
    <>
      <Card padding="md" className="stat-card stat-library">
        <h2 className="stat-label">
          <span className="stat-ico" aria-hidden="true">
            <Icon name="library" size="sm" />
          </span>
          Biblioteca
        </h2>
        <p className="stat-value">
          {formatCount(lib.total)} <span className="stat-unit">{plural(lib.total, 'título', 'títulos')}</span>
        </p>
        <SegmentedBar parts={parts} label="Composição da biblioteca por status" />
        <p className="stat-hint">
          {formatCount(lib.byStatus.watched)} {plural(lib.byStatus.watched, 'assistido', 'assistidos')}, tempo estimado de {formatHours(wt.hours)}. {missing}
        </p>
        <NumbersTable caption="Biblioteca por status" headers={['Status', 'Títulos']} rows={parts.map((p) => [p.label, String(p.value)])} />
      </Card>
      <Card padding="md" className="stat-card">
        <h2 className="stat-label">
          <span className="stat-ico" aria-hidden="true">
            <Icon name="bookmark" size="sm" />
          </span>
          Fila (quero ver)
        </h2>
        <p className="stat-value stat-value-sm">{b.headline}</p>
        <p className="stat-hint">{b.detail}</p>
      </Card>
    </>
  );
}
