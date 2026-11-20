import { type CalendarInfoDto, type CatalogSource, getCalendar, getCalendarDiscover, type CalendarEntryDto } from '../api/index.ts';
import { type AgendaEntry, cardHtml, entryKey, originOf, spotlightHtml } from './calendar-card.ts';
import { openCalendarDetail } from './calendar-detail.ts';
import { loadInfo, seedInfo } from './calendar-info.ts';
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

type OriginFilter = 'todos' | 'serie' | 'filme' | 'anime';
type WhereFilter = 'todos' | 'stream' | 'cinema';
const ORIGIN_CHIPS: Array<[OriginFilter, string]> = [['todos', 'Tudo'], ['serie', 'Séries'], ['filme', 'Filmes'], ['anime', 'Animes']];
const WHERE_CHIPS: Array<[WhereFilter, string]> = [['todos', 'Qualquer lugar'], ['stream', 'Streaming'], ['cinema', 'Cinema']];

export const renderCalendar = (host: HTMLElement): void => {
  let days = 30;
  let dayFilter: string | null = null;
  let entries: CalendarEntryDto[] = [];
  let discover: Omit<CalendarEntryDto, 'titleId'>[] = [];
  let discoverFailed: string[] = [];
  let originFilter: OriginFilter = 'todos';
  let whereFilter: WhereFilter = 'todos';
  const infos = new Map<string, CalendarInfoDto>();
  const infoOf = (e: AgendaEntry): CalendarInfoDto | null => e.info ?? infos.get(entryKey(e)) ?? null;
  const lookup = new Map<string, AgendaEntry>();

  host.innerHTML = `
    <header class="view-head">
      <h1 class="view-title">Agenda</h1>
      <p class="view-subtitle">Próximos episódios e estreias dos títulos que você acompanha, mais as grandes estreias da semana para descobrir.</p>
      <div style="margin-top:12px"><button class="btn btn-ghost btn-sm" id="subscribe" type="button">Assinar no calendário</button></div>
    </header>
    <div class="week-strip" id="week" role="group" aria-label="Próximos 7 dias"></div>
    <div class="chip-row" id="ranges" style="margin-bottom:10px" role="group" aria-label="Janela de dias"></div>
    <div class="chip-row" id="origins" style="margin-bottom:10px" role="group" aria-label="Filtrar por tipo"></div>
    <div class="chip-row" id="wheres" style="margin-bottom:22px" role="group" aria-label="Filtrar por onde assistir"></div>
    <div id="spot"></div>
    <div id="entries"><div class="skeleton" style="height:200px"></div></div>
  `;

  const rangesEl = host.querySelector('#ranges') as HTMLElement;
  const originsEl = host.querySelector('#origins') as HTMLElement;
  const wheresEl = host.querySelector('#wheres') as HTMLElement;
  const spotEl = host.querySelector('#spot') as HTMLElement;
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
    const passes = (e: AgendaEntry): boolean => {
      const info = infoOf(e);
      if (originFilter !== 'todos' && originOf(e, info) !== originFilter) return false;
      return whereFilter === 'todos' || info?.where === whereFilter;
    };
    const inRange = entries.filter((e) => e.date <= horizon && passes(e));
    const shown = dayFilter ? inRange.filter((e) => e.date === dayFilter) : inRange;
    const horizonIso = horizon;
    const found = (dayFilter ? discover.filter((e) => e.date === dayFilter) : discover.filter((e) => e.date <= horizonIso)).filter(passes).filter(
      (e) => !shown.some((s) => s.titleSource === e.titleSource && s.titleSourceId === e.titleSourceId && s.date === e.date),
    );
    const groups = (list: Omit<CalendarEntryDto, 'titleId'>[]) =>
      Array.from(groupByDay(list).entries())
        .map(([date, items]) => `<div class="calendar-day-group"><div class="calendar-day-label">${dayLabel(date)}</div><div class="calendar-list">${items.map((e) => cardHtml(e, infoOf(e))).join('')}</div></div>`)
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

    for (const e of [...shown, ...found]) lookup.set(entryKey(e), e);
    renderSpot([...shown, ...found]);
    observeMissingInfo();
  };

  /** Destaque: o primeiro item com capa larga entre os visíveis. */
  const renderSpot = (list: AgendaEntry[]) => {
    const pick = list.find((e) => infoOf(e)?.backdropUrl);
    const info = pick ? infoOf(pick) : null;
    spotEl.innerHTML = pick && info ? spotlightHtml(pick, info) : '';
  };

  // Cartões da biblioteca nascem sem ficha: busca ao entrarem na tela e troca só o cartão.
  const observer =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          (hits) => {
            for (const hit of hits) {
              if (!hit.isIntersecting) continue;
              const el = hit.target as HTMLElement;
              observer?.unobserve(el);
              const e = lookup.get(el.dataset.key ?? '');
              if (!e) continue;
              void loadInfo(e).then((info) => {
                if (!info || !el.isConnected) return;
                infos.set(entryKey(e), info);
                el.outerHTML = cardHtml(e, info);
                if (!spotEl.firstElementChild) renderSpot([e]);
              });
            }
          },
          { rootMargin: '200px' },
        );
  const observeMissingInfo = () => {
    for (const el of entriesEl.querySelectorAll<HTMLElement>('[data-needs-info]')) observer?.observe(el);
  };

  const openDetail = async (el: HTMLElement) => {
    const e = lookup.get(el.dataset.key ?? '');
    if (!e) return;
    const info = infoOf(e) ?? (await loadInfo(e));
    if (!entriesEl.isConnected) return;
    if (info) infos.set(entryKey(e), info);
    const go = () => navigate(titlePath(e.titleSource as CatalogSource, e.titleSource === 'archive' ? '_' : e.mediaType, e.titleSourceId));
    openCalendarDetail(e, info, go);
  };

  const onActivate = (ev: Event) => {
    const target = ev.target as HTMLElement;
    if (target.closest('a')) return;
    const el = target.closest<HTMLElement>('.cal-card, .cal-spot');
    if (el) void openDetail(el);
  };
  entriesEl.addEventListener('click', onActivate);
  spotEl.addEventListener('click', onActivate);

  let loadSeq = 0;
  const load = () => {
    const seq = ++loadSeq;
    entriesEl.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
    // A faixa da semana precisa de pelo menos 7 dias, mesmo que o intervalo escolhido seja menor.
    const discoverP = getCalendarDiscover(Math.max(days, 7)).catch(() => ({ entries: [], failed: ['serviço de lançamentos'] }));
    getCalendar(Math.max(days, 7))
      .then(async (data) => {
        const d = await discoverP;
        if (seq !== loadSeq || !entriesEl.isConnected) return;
        entries = data.entries;
        discover = d.entries;
        for (const e of d.entries) if (e.info) seedInfo(e, e.info);
        discoverFailed = d.failed;
        renderWeek();
        renderEntries();
      })
      .catch(() => {
        if (seq !== loadSeq || !entriesEl.isConnected) return;
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

  const chips = (el: HTMLElement, list: Array<[string, string]>, current: () => string, set: (v: string) => void) => {
    const paint = () => {
      el.innerHTML = list.map(([v, label]) => `<button class="chip${v === current() ? ' active' : ''}" type="button" data-v="${v}" aria-pressed="${v === current()}">${label}</button>`).join('');
    };
    el.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-v]');
      if (!btn) return;
      set(btn.dataset.v ?? 'todos');
      paint();
      renderEntries();
    });
    paint();
  };
  chips(originsEl, ORIGIN_CHIPS, () => originFilter, (v) => (originFilter = v as OriginFilter));
  chips(wheresEl, WHERE_CHIPS, () => whereFilter, (v) => (whereFilter = v as WhereFilter));

  rangesEl.innerHTML = RANGES.map((r) => `<button class="chip${r === days ? ' active' : ''}" type="button" data-days="${r}" aria-pressed="${r === days}">${r} dias</button>`).join('');
  rangesEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-days]');
    if (!btn) return;
    days = Number(btn.dataset.days);
    for (const c of rangesEl.querySelectorAll('.chip')) {
      c.classList.toggle('active', c === btn);
      c.setAttribute('aria-pressed', String(c === btn));
    }
    load();
  });

  load();
};
