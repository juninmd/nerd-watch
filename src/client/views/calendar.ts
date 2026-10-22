import { type CatalogSource, getCalendar, type CalendarEntryDto } from '../api.ts';
import { escapeHtml } from '../components/card.ts';
import { icon } from '../icons.ts';
import { navigate } from '../router.ts';
import { localIsoDate, weekCells } from '../time-format.ts';
import { titlePath } from '../title-link.ts';

const RANGES = [7, 14, 30, 60];

const dayLabel = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
};

const groupByDay = (entries: CalendarEntryDto[]): Map<string, CalendarEntryDto[]> => {
  const map = new Map<string, CalendarEntryDto[]>();
  for (const e of entries) {
    const list = map.get(e.date) ?? [];
    list.push(e);
    map.set(e.date, list);
  }
  return map;
};

const entryRow = (e: CalendarEntryDto): string => `
  <div class="calendar-item" data-source="${e.titleSource}" data-source-id="${escapeHtml(e.titleSourceId)}" data-media="${e.mediaType}" tabindex="0" role="link">
    <div class="thumb"${e.posterUrl ? ` style="background-image:url('${e.posterUrl}')"` : ''}>${e.posterUrl ? '' : icon('film')}</div>
    <div class="info">
      <div class="t">${escapeHtml(e.titleName)}</div>
      <div class="s">${e.kind === 'episode' ? `T${e.seasonNumber} · Ep ${e.episodeNumber}${e.episodeName ? ` — ${escapeHtml(e.episodeName)}` : ''}` : 'estreia do filme'}</div>
    </div>
  </div>`;

export const renderCalendar = (host: HTMLElement): void => {
  let days = 30;
  let dayFilter: string | null = null;
  let entries: CalendarEntryDto[] = [];

  host.innerHTML = `
    <header class="view-head">
      <h1 class="view-title">Agenda</h1>
      <p class="view-subtitle">Próximos episódios e estreias de filmes dos títulos que você está acompanhando.</p>
    </header>
    <div class="week-strip" id="week" role="group" aria-label="Próximos 7 dias"></div>
    <div class="chip-row" id="ranges" style="margin-bottom:22px"></div>
    <div id="entries"><div class="skeleton" style="height:200px"></div></div>
  `;

  const rangesEl = host.querySelector('#ranges') as HTMLElement;
  const entriesEl = host.querySelector('#entries') as HTMLElement;
  const weekEl = host.querySelector('#week') as HTMLElement;

  const renderWeek = () => {
    const todayIso = localIsoDate(new Date());
    weekEl.innerHTML = weekCells(new Date(), 7, entries)
      .map((cell) => {
        const weekday = cell.iso === todayIso ? 'hoje' : cell.date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
        const on = dayFilter === cell.iso;
        return `<button type="button" class="day${on ? ' active' : ''}${cell.count ? ' has' : ''}" data-day="${cell.iso}" aria-pressed="${on}" aria-label="${dayLabel(cell.iso)}: ${cell.count} lançamento(s)"><small>${weekday}</small><b>${cell.date.getDate()}</b><span class="dot">${cell.count || ''}</span></button>`;
      })
      .join('');
  };

  const renderEntries = () => {
    const horizon = localIsoDate(new Date(Date.now() + days * 86_400_000));
    const inRange = entries.filter((e) => e.date <= horizon);
    const shown = dayFilter ? inRange.filter((e) => e.date === dayFilter) : inRange;
    if (shown.length === 0) {
      entriesEl.innerHTML = dayFilter
        ? `<div class="empty-state">nada previsto para ${dayLabel(dayFilter)} — <button class="btn btn-ghost btn-sm" id="clear-day" type="button">ver todos os dias</button></div>`
        : `<div class="empty-state"><div class="big">📭</div>nada previsto nos próximos ${days} dias — acompanhe algo em <a href="#/library">Biblioteca</a></div>`;
      entriesEl.querySelector('#clear-day')?.addEventListener('click', () => {
        dayFilter = null;
        renderWeek();
        renderEntries();
      });
      return;
    }
    entriesEl.innerHTML = Array.from(groupByDay(shown).entries())
      .map(([date, items]) => `<div class="calendar-day-group"><div class="calendar-day-label">${dayLabel(date)}</div><div class="calendar-list">${items.map(entryRow).join('')}</div></div>`)
      .join('');

    for (const el of entriesEl.querySelectorAll<HTMLElement>('.calendar-item')) {
      const { source, sourceId, media } = el.dataset;
      if (!source || !sourceId || !media) continue;
      const go = () => navigate(titlePath(source as CatalogSource, source === 'archive' ? '_' : (media as 'movie' | 'tv'), sourceId));
      el.addEventListener('click', go);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') go();
      });
    }
  };

  const load = () => {
    entriesEl.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
    // A faixa da semana precisa de pelo menos 7 dias, mesmo que o intervalo escolhido seja menor.
    getCalendar(Math.max(days, 7))
      .then((data) => {
        entries = data.entries;
        renderWeek();
        renderEntries();
      })
      .catch(() => {
        entriesEl.innerHTML = `<div class="empty-state"><div class="big">⚠️</div>não foi possível carregar a agenda</div>`;
      });
  };

  weekEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-day]');
    if (!btn) return;
    dayFilter = dayFilter === btn.dataset.day ? null : (btn.dataset.day ?? null);
    renderWeek();
    renderEntries();
  });

  rangesEl.innerHTML = RANGES.map((r) => `<button class="chip${r === days ? ' active' : ''}" type="button" data-days="${r}">${r} dias</button>`).join('');
  rangesEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-days]');
    if (!btn) return;
    days = Number(btn.dataset.days);
    for (const c of rangesEl.querySelectorAll('.chip')) c.classList.toggle('active', c === btn);
    load();
  });

  load();
};
