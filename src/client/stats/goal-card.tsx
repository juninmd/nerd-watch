import type { StatsSummary } from '../../server/stats/summary.ts';
import { Card, ProgressRing, TextField } from '@juninmd/sonido';
import { useState } from 'react';
import { Icon } from '../ui/icon.tsx';
import { localIsoDate } from '../ui/time-format.ts';
import { GOAL_MAX, GOAL_MIN, parseGoal, readGoal, saveGoal } from './goal.ts';
import { goalView } from './insights.ts';
import { plural } from './model.ts';

/**
 * Cartão da meta do ano. Sem meta, mostra o campo para definir; com meta, o anel e o ritmo. O campo fica sempre na
 * mesma posição da árvore, então salvar não remonta o input e o foco continua nele.
 */
export function GoalCard({ s }: { s: StatsSummary }) {
  const [goal, setGoal] = useState<number | null>(readGoal);
  const [draft, setDraft] = useState(goal === null ? '' : String(goal));
  const [error, setError] = useState<string | undefined>();

  // Grava ao sair do campo ou no Enter, como o `change` nativo.
  const commit = (): void => {
    const raw = draft.trim();
    const next = raw === '' ? null : parseGoal(raw);
    if (next === null && raw !== '') {
      setError('Use um número inteiro de 1 a 999.');
      return;
    }
    if (next === goal) return;
    saveGoal(next);
    setGoal(next);
  };

  const view = goal === null ? null : goalView(s.period.finished, goal, s.year, localIsoDate(new Date()));
  const percent = view ? Math.min(999, Math.round(view.progress * 100)) : 0;
  return (
    <Card padding="md" className="stat-card stat-goal">
      <h2 className="stat-label">
        <span className="stat-ico" aria-hidden="true">
          <Icon name="target" size="sm" />
        </span>
        Meta do ano
      </h2>
      {view === null && <p className="stat-hint">Defina quantos títulos quer concluir no ano e acompanhe o ritmo. Fica só neste navegador.</p>}
      <div className="goal-body">
        {view && goal !== null && (
          <ProgressRing value={view.progress} size={128} thickness={10} label={`${percent}% da meta: ${view.headline} títulos`}>
            <span className="ring-center">
              <strong>{percent}%</strong>
              <span>da meta</span>
            </span>
          </ProgressRing>
        )}
        <div className="goal-text">
          {view && goal !== null && (
            <>
              <p className="stat-value stat-value-sm">
                {view.headline} <span className="stat-unit">{plural(goal, 'título', 'títulos')}</span>
              </p>
              <p className="stat-hint">{view.detail}</p>
            </>
          )}
          <TextField
            className="goal-field"
            label={`Meta de conclusões em ${s.year}`}
            type="number"
            inputMode="numeric"
            min={GOAL_MIN}
            max={GOAL_MAX}
            step={1}
            placeholder="ex.: 24"
            value={draft}
            error={error}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(undefined);
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
            }}
          />
        </div>
      </div>
    </Card>
  );
}
