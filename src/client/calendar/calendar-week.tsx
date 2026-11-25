import { Button } from '@juninmd/sonido';
import { localIsoDate, weekCells } from '../ui/time-format.ts';
import { dayLabel } from './calendar-model.ts';

/** Faixa dos próximos 7 dias com a contagem de lançamentos; clicar filtra pelo dia, clicar de novo desfaz. */
export function CalendarWeek({
  entries,
  value,
  onChange,
}: {
  entries: Array<{ date: string }>;
  value: string | null;
  onChange: (day: string | null) => void;
}) {
  const now = new Date();
  const todayIso = localIsoDate(now);
  return (
    <fieldset className="week-strip">
      <legend className="sr-only">Próximos 7 dias</legend>
      {weekCells(now, 7, entries).map((cell) => {
        const on = value === cell.iso;
        const weekday =
          cell.iso === todayIso ? 'hoje' : cell.date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
        return (
          <Button
            key={cell.iso}
            variant={on ? 'secondary' : 'ghost'}
            className={`day${on ? ' active' : ''}${cell.count ? ' has' : ''}`}
            aria-pressed={on}
            aria-label={`${dayLabel(cell.iso)}: ${cell.count} lançamento(s)`}
            onClick={() => onChange(on ? null : cell.iso)}
          >
            <small>{weekday}</small>
            <b>{cell.date.getDate()}</b>
            <span className="dot">{cell.count || ''}</span>
          </Button>
        );
      })}
    </fieldset>
  );
}
