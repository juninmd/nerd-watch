import { getCalendar, health, listLibrary, searchArchive } from '../api.ts';
import { escapeHtml, renderCard } from '../components/card.ts';
import { navigate } from '../router.ts';
import { titlePath } from '../title-link.ts';

const SKELETON = `
  <div class="section"><div class="skeleton" style="height:22px;width:220px;margin-bottom:14px"></div>
    <div class="rail">${Array.from({ length: 5 }, () => '<div class="skeleton" style="width:168px;aspect-ratio:2/3;flex:0 0 168px"></div>').join('')}</div>
  </div>
`;

const dateLabel = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};

export const renderDiscover = (host: HTMLElement): void => {
  host.innerHTML = `
    <h1 class="view-title">Bem-vindo de volta 👋</h1>
    <p class="view-subtitle">O que você está assistindo, o que estreia em breve e clássicos de domínio público prontos para assistir agora.</p>
    <div id="tmdb-banner"></div>
    ${SKELETON}${SKELETON}
  `;

  Promise.all([
    health(),
    listLibrary('watching'),
    searchArchive('').catch(() => ({ results: [] })),
    getCalendar(14),
  ])
    .then(([h, watching, archive, calendar]) => {
      const banner = h.tmdbEnabled
        ? ''
        : `<div class="tmdb-off-banner">⚠️ Catálogo TMDB desligado — adicione <code>TMDB_API_KEY</code> no <code>.env</code> para buscar filmes e séries protegidos. Domínio público e sua lista funcionam normalmente.</div>`;

      host.innerHTML = `
        <h1 class="view-title">Bem-vindo de volta 👋</h1>
        <p class="view-subtitle">O que você está assistindo, o que estreia em breve e clássicos de domínio público prontos para assistir agora.</p>
        ${banner}
        <div class="section">
          <div class="section-head"><h2>▶️ Continuar assistindo</h2><span class="hint"><a href="#/my-list">ver lista completa</a></span></div>
          <div class="rail" id="watching-rail"></div>
        </div>
        <div class="section">
          <div class="section-head"><h2>🗓️ Próximos 14 dias</h2><span class="hint"><a href="#/calendar">ver calendário</a></span></div>
          <div id="calendar-preview"></div>
        </div>
        <div class="section">
          <div class="section-head"><h2>🎞️ Domínio público em destaque</h2><span class="hint"><a href="#/public-domain">ver tudo</a></span></div>
          <div class="rail" id="archive-rail"></div>
        </div>
      `;

      const watchingRail = host.querySelector('#watching-rail') as HTMLElement;
      if (watching.items.length === 0) {
        watchingRail.innerHTML = `<div class="empty-state" style="flex:1"><div class="big">🍿</div>nada em andamento — busque algo e marque como "assistindo"</div>`;
      } else {
        for (const item of watching.items) {
          watchingRail.appendChild(
            renderCard({
              title: item.title.title,
              posterUrl: item.title.posterUrl,
              meta: item.currentSeason ? `T${item.currentSeason} · Ep ${item.currentEpisode}` : undefined,
              status: item.watchStatus,
              onClick: () => navigate(titlePath(item.title.source, item.title.mediaType, item.title.sourceId)),
            }),
          );
        }
      }

      const calPreview = host.querySelector('#calendar-preview') as HTMLElement;
      if (calendar.entries.length === 0) {
        calPreview.innerHTML = `<div class="empty-state"><div class="big">📭</div>nada previsto nos próximos 14 dias para os títulos da sua lista</div>`;
      } else {
        calPreview.innerHTML = `<div class="calendar-list">${calendar.entries
          .slice(0, 5)
          .map(
            (e) => `
          <div class="calendar-item">
            <div class="thumb"${e.posterUrl ? ` style="background-image:url('${e.posterUrl}')"` : ''}>${e.posterUrl ? '' : '🎬'}</div>
            <div class="info">
              <div class="t">${escapeHtml(e.titleName)}</div>
              <div class="s">${e.kind === 'episode' ? `T${e.seasonNumber} · Ep ${e.episodeNumber} — ${escapeHtml(e.episodeName ?? '')}` : 'estreia do filme'}</div>
            </div>
            <div class="s">${dateLabel(e.date)}</div>
          </div>`,
          )
          .join('')}</div>`;
      }

      const archiveRail = host.querySelector('#archive-rail') as HTMLElement;
      for (const m of archive.results.slice(0, 10)) {
        archiveRail.appendChild(
          renderCard({
            title: m.title,
            posterUrl: m.thumbnailUrl,
            meta: m.year ?? undefined,
            isPublicDomain: true,
            onClick: () => navigate(titlePath('archive', '_', m.identifier)),
          }),
        );
      }
    })
    .catch(() => {
      host.innerHTML = `<div class="empty-state"><div class="big">⚠️</div>não foi possível carregar o início agora</div>`;
    });
};
