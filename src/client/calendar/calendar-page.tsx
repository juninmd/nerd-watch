import { Button, EmptyState, FilterChips, Skeleton, WeekStrip } from '@juninmd/sonido';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type CalendarEntryDto,
  type CalendarInfoDto,
  type CatalogSource,
  getCalendar,
  getCalendarDiscover,
} from '../api/index.ts';
import { navigate } from '../app/router.ts';
import { showToast } from '../app/state.ts';
import { useAlive } from '../library/use-alive.ts';
import { Icon } from '../ui/icon.tsx';
import { countByDay, localIsoDate } from '../ui/time-format.ts';
import { titlePath } from '../ui/title-link.ts';
import { CalendarCard, CalendarSpotlight } from './calendar-card.tsx';
import { openCalendarDetail } from './calendar-detail.tsx';
import { loadInfo, seedInfo } from './calendar-info.ts';
import { type AgendaEntry, dayLabel, entryKey, groupByDay, originOf } from './calendar-model.ts';

type Range = '7' | '14' | '30' | '60';
const RANGES: Array<{ key: Range; label: string }> = (['7', '14', '30', '60'] as const).map((r) => ({
  key: r,
  label: `${r} dias`,
}));
type OriginFilter = 'serie' | 'filme' | 'anime';
type WhereFilter = 'stream' | 'cinema';
const ORIGIN_CHIPS: Array<{ key: OriginFilter; label: string }> = [
  { key: 'serie', label: 'Séries' },
  { key: 'filme', label: 'Filmes' },
  { key: 'anime', label: 'Animes' },
];
const WHERE_CHIPS: Array<{ key: WhereFilter; label: string }> = [
  { key: 'stream', label: 'Streaming' },
  { key: 'cinema', label: 'Cinema' },
];

type Data = { entries: CalendarEntryDto[]; discover: AgendaEntry[]; failed: string[] } | 'loading' | 'error';

/** Copia o feed .ics (sempre o padrão de 60 dias, para a assinatura não mudar com o filtro da tela). */
const subscribe = async () => {
  const url = new URL('/api/calendar.ics', location.origin).href;
  try {
    await navigator.clipboard.writeText(url);
    showToast('Link copiado: cole no seu app de calendário');
  } catch {
    // Sem permissão de área de transferência, o link aparece no aviso para copiar à mão.
    showToast(url);
  }
};

export function CalendarPage() {
  const [days, setDays] = useState<Range>('30');
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const [data, setData] = useState<Data>('loading');
  const [origin, setOrigin] = useState<OriginFilter | null>(null);
  const [where, setWhere] = useState<WhereFilter | null>(null);
  const [infos, setInfos] = useState<ReadonlyMap<string, CalendarInfoDto>>(new Map());
  const alive = useAlive();
  const loadSeq = useRef(0);

  useEffect(() => {
    const seq = ++loadSeq.current;
    setData('loading');
    // A faixa da semana precisa de pelo menos 7 dias, mesmo que o intervalo escolhido seja menor.
    const span = Math.max(Number(days), 7);
    const discoverP = getCalendarDiscover(span).catch(() => ({
      entries: [] as AgendaEntry[],
      failed: ['serviço de lançamentos'],
    }));
    getCalendar(span)
      .then(async (res) => {
        const d = await discoverP;
        if (seq !== loadSeq.current || !alive.current) return;
        for (const e of d.entries) if (e.info) seedInfo(e, e.info);
        setData({ entries: res.entries, discover: d.entries, failed: d.failed });
      })
      .catch(() => {
        if (seq === loadSeq.current && alive.current) setData('error');
      });
  }, [days, alive]);

  const infoOf = (e: AgendaEntry): CalendarInfoDto | null => e.info ?? infos.get(entryKey(e)) ?? null;
  const onInfo = useCallback(
    (e: AgendaEntry, info: CalendarInfoDto) => setInfos((prev) => new Map(prev).set(entryKey(e), info)),
    [],
  );

  const openDetail = async (e: AgendaEntry) => {
    const info = infoOf(e) ?? (await loadInfo(e));
    if (!alive.current) return;
    if (info) onInfo(e, info);
    openCalendarDetail(e, info, () =>
      navigate(
        titlePath(e.titleSource as CatalogSource, e.titleSource === 'archive' ? '_' : e.mediaType, e.titleSourceId),
      ),
    );
  };

  const head = (
    <>
      <header className="view-head">
        <h1 className="view-title">Agenda</h1>
        <p className="view-subtitle">
          Próximos episódios e estreias dos títulos que você acompanha, mais as grandes estreias da semana para
          descobrir.
        </p>
        <Button variant="ghost" size="sm" onClick={subscribe}>
          Assinar no calendário
        </Button>
      </header>
      {typeof data === 'object' && (
        <WeekStrip
          className="week-strip"
          label="Próximos 7 dias"
          counts={countByDay([...data.entries, ...data.discover])}
          value={dayFilter}
          onChange={setDayFilter}
          dayLabel={(d) => `${d.isToday ? 'hoje, ' : ''}${dayLabel(d.iso)}: ${d.count} lançamento(s)`}
        />
      )}
      <div className="cal-filters">
        <FilterChips label="Janela de dias" chips={RANGES} value={days} onChange={(v) => v && setDays(v)} />
        <FilterChips
          label="Filtrar por tipo"
          chips={ORIGIN_CHIPS}
          value={origin}
          onChange={setOrigin}
          allLabel="Tudo"
        />
        <FilterChips
          label="Filtrar por onde assistir"
          chips={WHERE_CHIPS}
          value={where}
          onChange={setWhere}
          allLabel="Qualquer lugar"
        />
      </div>
    </>
  );

  if (data === 'loading')
    return (
      <>
        {head}
        <Skeleton label="Carregando agenda…" rows={4} media />
      </>
    );
  if (data === 'error')
    return (
      <>
        {head}
        <EmptyState icon={<Icon name="alert" />} title="não foi possível carregar a agenda" />
      </>
    );

  const horizon = localIsoDate(new Date(Date.now() + Number(days) * 86_400_000));
  const passes = (e: AgendaEntry): boolean => {
    const info = infoOf(e);
    if (origin && originOf(e, info) !== origin) return false;
    return !where || info?.where === where;
  };
  const inWindow = (e: AgendaEntry) => (dayFilter ? e.date === dayFilter : e.date <= horizon);
  const shown = data.entries.filter((e) => inWindow(e) && passes(e));
  const found = data.discover.filter(
    (e) =>
      inWindow(e) &&
      passes(e) &&
      !shown.some((s) => s.titleSource === e.titleSource && s.titleSourceId === e.titleSourceId && s.date === e.date),
  );
  const warn = data.failed.length > 0 && <EmptyState title={`fontes indisponíveis agora: ${data.failed.join(', ')}`} />;

  if (shown.length === 0 && found.length === 0) {
    return (
      <>
        {head}
        {dayFilter ? (
          <EmptyState
            title={`nada previsto para ${dayLabel(dayFilter)}`}
            action={
              <Button variant="ghost" size="sm" onClick={() => setDayFilter(null)}>
                ver todos os dias
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Icon name="inbox" />}
            title={`nada previsto nos próximos ${days} dias`}
            description={
              <>
                acompanhe algo em <a href="#/library">Biblioteca</a>
              </>
            }
          />
        )}
        {warn}
      </>
    );
  }

  const groups = (list: AgendaEntry[]) =>
    Array.from(groupByDay(list).entries()).map(([date, items]) => (
      <div key={date} className="calendar-day-group">
        <div className="calendar-day-label">{dayLabel(date)}</div>
        <div className="calendar-list">
          {items.map((e) => (
            <CalendarCard
              key={`${entryKey(e)}:${e.date}:${e.seasonNumber}:${e.episodeNumber}`}
              entry={e}
              info={infoOf(e)}
              onInfo={onInfo}
              onOpen={openDetail}
            />
          ))}
        </div>
      </div>
    ));

  const spot = [...shown, ...found].find((e) => infoOf(e)?.backdropUrl);
  const spotInfo = spot ? infoOf(spot) : null;
  return (
    <>
      {head}
      {spot && spotInfo && <CalendarSpotlight entry={spot} info={spotInfo} onOpen={() => void openDetail(spot)} />}
      {groups(shown)}
      {found.length > 0 && (
        <>
          <h2 className="view-subtitle cal-discover-title">Estreias para descobrir</h2>
          {groups(found)}
        </>
      )}
      {warn}
    </>
  );
}
