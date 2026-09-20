import { getCalendar, type CalendarEntryDto } from '../api.ts';
import { escapeHtml } from '../components/card.ts';
import { navigate } from '../router.ts';
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

export const renderCalendar = (host: HTMLElement): void => {
  let days = 30;

  host.innerHTML = `
    <h1 class="view-title">Calendário de lançamentos</h1>
    <p class="view-subtitle">Próximos episódios e estreias de filmes dos títulos que você está acompanhando.</p>
    <div class="chip-row" id="ranges" style="margin-bottom:22px"></div>
    <div id="entries"><div class="skeleton" style="height:200px"></div></div>
  `;

  const rangesEl = host.querySelector('#ranges') as HTMLElement;
  const entriesEl = host.querySelector('#entries') as HTMLElement;

  const load = () => {
    entriesEl.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
    getCalendar(days)
      .then((data) => {
        if (data.entries.length === 0) {
          entriesEl.innerHTML = `<div class="empty-state"><div class="big">📭</div>nada previsto nos próximos ${days} dias — acompanhe algo em <a href="#/my-list">Minha lista</a></div>`;
          return;
        }
        const groups = groupByDay(data.entries);
        entriesEl.innerHTML = Array.from(groups.entries())
          .map(
            ([date, items]) => `
            <div class="calendar-day-group">
              <div class="calendar-day-label">${dayLabel(date)}</div>
              <div class="calendar-list">
                ${items
                  .map(
                    (e) => `
                  <div class="calendar-item" data-source="${e.titleSource}" data-source-id="${escapeHtml(e.titleSourceId)}" data-media="${e.mediaType}" style="cursor:pointer">
                    <div class="thumb"${e.posterUrl ? ` style="background-image:url('${e.posterUrl}')"` : ''}>${e.posterUrl ? '' : '🎬'}</div>
                    <div class="info">
                      <div class="t">${escapeHtml(e.titleName)}</div>
                      <div class="s">${e.kind === 'episode' ? `T${e.seasonNumber} · Ep ${e.episodeNumber} — ${escapeHtml(e.episodeName ?? '')}` : 'estreia do filme'}</div>
                    </div>
                  </div>`,
                  )
                  .join('')}
              </div>
            </div>`,
          )
          .join('');

        entriesEl.querySelectorAll<HTMLElement>('.calendar-item').forEach((el) => {
          const source = el.dataset.source as 'tmdb' | 'archive' | undefined;
          const sourceId = el.dataset.sourceId;
          const mediaType = el.dataset.media as 'movie' | 'tv' | undefined;
          if (!source || !sourceId || !mediaType) return;
          el.addEventListener('click', () => navigate(titlePath(source, source === 'archive' ? '_' : mediaType, sourceId)));
        });
      })
      .catch(() => {
        entriesEl.innerHTML = `<div class="empty-state"><div class="big">⚠️</div>não foi possível carregar o calendário</div>`;
      });
  };

  rangesEl.innerHTML = RANGES.map((r) => `<button class="chip${r === days ? ' active' : ''}" data-days="${r}">${r} dias</button>`).join('');
  rangesEl.querySelectorAll<HTMLButtonElement>('.chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      days = Number(btn.dataset.days);
      rangesEl.querySelectorAll('.chip').forEach((c) => {
        c.classList.toggle('active', c === btn);
      });
      load();
    });
  });

  load();
};
