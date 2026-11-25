import type { StatsSummary } from '../../server/stats/summary.ts';
import { Accordion, Alert, CountUp, EmptyState, StatTile } from '@juninmd/sonido';
import { Icon } from '../ui/icon.tsx';
import type { IconName } from '../ui/icons.ts';
import { GoalCard } from './goal-card.tsx';
import { LibraryCards } from './library-cards.tsx';
import { kpiCards } from './model.ts';
import { StatsCharts } from './stats-figures.tsx';

const KPI_ICON: Record<string, IconName> = {
  finished: 'check',
  hours: 'clock',
  days: 'flame',
  rating: 'star',
  genre: 'tag',
  weekday: 'calendar',
};

/** Inteiros sobem de zero até o valor; acima de 999 o texto formatado tem separador de milhar e fica pronto, sem animação. */
const countable = (n: number | undefined): n is number => n !== undefined && Number.isInteger(n) && n > 0 && n < 1000;

function Kpis({ s }: { s: StatsSummary }) {
  return (
    <div className="stat-kpis">
      {kpiCards(s).map((k) => (
        <StatTile
          key={k.id}
          label={k.label}
          value={countable(k.count) ? <CountUp value={k.count} duration={700} /> : k.value}
          hint={k.hint}
          icon={<Icon name={KPI_ICON[k.id] ?? 'chart'} size="sm" />}
        />
      ))}
    </div>
  );
}

function Notes({ timezone }: { timezone: string }) {
  return (
    <Accordion
      className="stat-notes"
      items={[
        {
          key: 'how',
          title: 'Como calculamos',
          content: (
            <ul>
              <li>"Concluído" e "revisão" vêm do histórico da lista. Cada um conta uma exibição do título.</li>
              <li>
                Tempo assistido = duração do título por exibição (filme: duração; série: soma dos episódios com duração no catálogo). Sem duração, a
                exibição fica de fora e é contada, não tratada como zero.
              </li>
              <li>Marcar episódio é atividade, não tempo: aparece nos dias ativos, no mapa e no mês, mas não soma horas.</li>
              <li>No mapa de atividade, a cor de cada dia é relativa aos outros dias ativos do ano (cinco faixas, por quantis).</li>
              <li>A meta do ano conta os títulos concluídos e fica só neste navegador.</li>
              <li>Datas são o dia civil no fuso do seu navegador ({timezone}), com horário de verão.</li>
              <li>Gêneros e notas contam cada título uma vez no ano.</li>
            </ul>
          ),
        },
      ]}
    />
  );
}

/** Resumo do ano: destaques, meta, biblioteca, gráficos e a nota de cálculo. */
export function StatsBody({ s, isCurrentYear }: { s: StatsSummary; isCurrentYear: boolean }) {
  if (!s.hasData) {
    return (
      <EmptyState
        className="stat-empty-all"
        icon={<Icon name="chart" />}
        title="Ainda não há dados para estatísticas."
        description={
          <>
            Marque títulos como assistidos na <a href="#/library">Biblioteca</a> e eles aparecem aqui.
          </>
        }
      />
    );
  }
  return (
    <>
      {s.period.activeDays === 0 && (
        <Alert tone="info" className="stat-empty">
          Nenhuma atividade registrada em {s.year}. Os números abaixo ficam zerados até você concluir ou revisar um título nesse ano.
        </Alert>
      )}
      <Kpis s={s} />
      <section className="stats-wide" aria-label="Meta, biblioteca e fila">
        <GoalCard s={s} />
        <LibraryCards s={s} />
      </section>
      <StatsCharts s={s} isCurrentYear={isCurrentYear} />
      <Notes timezone={s.timezone} />
    </>
  );
}
