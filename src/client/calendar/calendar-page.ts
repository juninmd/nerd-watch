import { type CatalogSource, getCalendar, getCalendarDiscover, type CalendarEntryDto } from '../api/index.ts';
import { escapeHtml } from '../ui/card.ts';
import { icon } from '../ui/icons.ts';
import { navigate } from '../app/router.ts';
import { showToast } from '../app/state.ts';
import { localIsoDate, weekCells } from '../ui/time-format.ts';
import { titlePath } from '../ui/title-link.ts';

const RANGES = [7, 14, 30, 60];

const dayLabel = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
};

const groupByDay = <T extends { date: string }>(entries: T[]): Map<string, T[]> => {
  const map = new Map<string, T[]>();
  for (const e of entries) {
    const list = map.get(e.date) ?? [];
    list.push(e);
    map.set(e.date, list);
  }
  return map;
};

const entryRow = (e: Omit<CalendarEntryDto, 'titleId'>): string => `
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
  let discover: Omit<CalendarEntryDto, 'titleId'>[] = [];
  let discoverFailed: string[] = [];

  host.innerHTML = `
    <header class="view-head">
      <h1 class="view-title">Agenda</h1>
      <p class="view-subtitle">Próximos episódios e estreias dos títulos que você acompanha, mais as grandes estreias da semana para descobrir.</p>
      <div style="margin-top:12px"><button class="btn btn-ghost btn-sm" id="subscribe" type="button">Assinar no calendário</button></div>
    </header>
    <div class="week-strip" id="week" role="group" aria-label="Próximos 7 dias"></div>
    <div class="chip-row" id="ranges" style="margin-bottom:22px"></div>
    <div id="entries"><div class="skeleton" style="height:200px"></div></div>
  `;

  const rangesEl = host.querySelector('#ranges') as HTMLElement;
  const entriesEl = host.querySelector('#entries') as HTMLElement;
  const weekEl = host.querySelector('#week') as HTMLElement;

  // Copia o feed .ics (sempre o padrão de 60 dias, para a assinatura não mudar com o filtro da tela).
  host.querySelector('#subscribe')?.addEventListener('click', async () => {
    const url = new URL('/api/calendar.ics', location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copiado: cole no seu app de calendário');
    } catch {
      // Sem permissão de área de transferência, o link aparece no aviso para copiar à mão.
      showToast(url);
    }
  });

  const renderWeek = () => {
    const todayIso = localIsoDate(new Date());
    weekEl.innerHTML = weekCells(new Date(), 7, [...entries, ...discover])
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
    const horizonIso = horizon;
    const found = (dayFilter ? discover.filter((e) => e.date === dayFilter) : discover.filter((e) => e.date <= horizonIso)).filter(
      (e) => !shown.some((s) => s.titleSource === e.titleSource && s.titleSourceId === e.titleSourceId && s.date === e.date),
    );
    const groups = (list: Omit<CalendarEntryDto, 'titleId'>[]) =>
      Array.from(groupByDay(list).entries())
        .map(([date, items]) => `<div class="calendar-day-group"><div class="calendar-day-label">${dayLabel(date)}</div><div class="calendar-list">${items.map(entryRow).join('')}</div></div>`)
        .join('');
    const warn = discoverFailed.length ? `<div class="empty-state">fontes indisponíveis agora: ${escapeHtml(discoverFailed.join(', '))}</div>` : '';
    const discoverBlock = found.length
      ? `<h2 class="view-subtitle" style="margin:18px 0 10px">Estreias para descobrir</h2>${groups(found)}${warn}`
      : warn;
    if (shown.length === 0 && found.length === 0) {
      entriesEl.innerHTML =
        (dayFilter
          ? `<div class="empty-state">nada previsto para ${dayLabel(dayFilter)} — <button class="btn btn-ghost btn-sm" id="clear-day" type="button">ver todos os dias</button></div>`
          : `<div class="empty-state"><div class="big">${icon('inbox')}</div>nada previsto nos próximos ${days} dias — acompanhe algo em <a href="#/library">Biblioteca</a></div>`) + (discoverFailed.length ? warn : '');
      entriesEl.querySelector('#clear-day')?.addEventListener('click', () => {
        dayFilter = null;
        renderWeek();
        renderEntries();
      });
      return;
    }
    entriesEl.innerHTML = (shown.length ? groups(shown) : '') + discoverBlock;

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
    const discoverP = getCalendarDiscover(Math.max(days, 7)).catch(() => ({ entries: [], failed: ['serviço de lançamentos'] }));
    getCalendar(Math.max(days, 7))
      .then(async (data) => {
        entries = data.entries;
        const d = await discoverP;
        discover = d.entries;
        discoverFailed = d.failed;
        renderWeek();
        renderEntries();
      })
      .catch(() => {
        entriesEl.innerHTML = `<div class="empty-state"><div class="big">${icon('alert')}</div>não foi possível carregar a agenda</div>`;
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
