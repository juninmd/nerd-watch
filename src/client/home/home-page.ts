import { type CalendarEntryDto, type CatalogSource, getCalendar, getStats, health, listLibrary, listUpNext, searchArchive } from '../api/index.ts';
import { watchPath } from '../channels/telegram-items.ts';
import { escapeHtml, renderCard } from '../ui/card.ts';
import { continueWatchingCards, refreshResumeCards } from '../player/continue-watching.ts';
import { renderTelegramFeed } from '../channels/telegram-feed.ts';
import { icon, type IconName } from '../ui/icons.ts';
import { paletteKeyLabel } from '../app/shortcut-keys.ts';
import { PLAYBACK_CHANGED_EVENT } from '../player/playback-sync.ts';
import { navigate } from '../app/router.ts';
import { yearStrip } from '../stats/insights.ts';
import { addDays, browserTimeZone, localIsoDate } from '../ui/time-format.ts';
import { libraryItemPath, titlePath } from '../ui/title-link.ts';

const SKELETON = `
  <div class="section"><div class="skeleton" style="height:22px;width:220px;margin-bottom:14px"></div>
    <div class="rail">${Array.from({ length: 5 }, () => '<div class="skeleton" style="width:168px;aspect-ratio:2/3;flex:0 0 168px"></div>').join('')}</div>
  </div>
`;

const sectionHead = (iconName: IconName, title: string, link?: { href: string; label: string }): string =>
  `<div class="section-head"><h2>${icon(iconName, 'sm')} ${title}</h2>${link ? `<a href="${link.href}">${link.label}</a>` : ''}</div>`;

const entryLine = (e: CalendarEntryDto): string =>
  e.kind === 'episode' ? `T${e.seasonNumber} · Ep ${e.episodeNumber}${e.episodeName ? ` — ${escapeHtml(e.episodeName)}` : ''}` : 'estreia do filme';

const upcomingRows = (entries: CalendarEntryDto[], todayIso: string): string =>
  entries
    .map(
      (e) => `
      <div class="calendar-item" data-source="${e.titleSource}" data-source-id="${escapeHtml(e.titleSourceId)}" data-media="${e.mediaType}" tabindex="0" role="link">
        <div class="thumb"${e.posterUrl ? ` style="background-image:url('${e.posterUrl}')"` : ''}>${e.posterUrl ? '' : icon('film')}</div>
        <div class="info"><div class="t">${escapeHtml(e.titleName)}</div><div class="s">${entryLine(e)}</div></div>
        <div class="s">${e.date === todayIso ? 'hoje' : 'amanhã'}</div>
      </div>`,
    )
    .join('');

const RAIL_SKELETON = Array.from({ length: 7 }, () => '<div class="skeleton" style="width:168px;aspect-ratio:2/3;flex:0 0 168px"></div>').join('');

/** Faixa "Seu ano": três números e as conclusões por mês, levando às estatísticas. Sem atividade no ano, não aparece. */
const yearStripHtml = (strip: ReturnType<typeof yearStrip>): string => {
  if (!strip) return '';
  const max = Math.max(1, ...strip.months);
  const bars = strip.months
    .map((v, i) => `<i class="${i === strip.currentMonth ? 'is-now' : ''}" style="--h:${Math.round((v / max) * 100)}%"></i>`)
    .join('');
  return `
    <a class="year-strip" href="#/stats" aria-label="${escapeHtml(strip.label)}">
      <span class="ys-title">${icon('chart', 'sm')} Seu ano em ${strip.year}</span>
      ${strip.items.map((item) => `<span class="ys-item"><strong>${escapeHtml(item.value)}</strong><span>${escapeHtml(item.label)}</span></span>`).join('')}
      <span class="ys-spark" aria-hidden="true">${bars}</span>
      <span class="ys-more">ver estatísticas ${icon('forward', 'sm')}</span>
    </a>`;
};

export const renderHome = (host: HTMLElement): void => {
  // O cabeçalho é desenhado uma vez só: o foco de teclado vai para o h1 ao abrir a tela, e trocar o h1 quando os
  // dados chegassem jogaria esse foco fora.
  host.innerHTML = `
    <header class="view-head"><h1 class="view-title">Bem-vindo de volta</h1>
    <p class="view-subtitle">O que você está assistindo, o que sai hoje e amanhã, o que chegou nos seus canais e clássicos de domínio público.</p></header>
    <div id="home-body">${SKELETON}${SKELETON}</div>
  `;
  const body = host.querySelector('#home-body') as HTMLElement;

  const today = new Date();
  const todayIso = localIsoDate(today);
  const tomorrowIso = localIsoDate(addDays(today, 1));

  // O acervo do Internet Archive depende de rede externa: sai do caminho da primeira pintura. A tela aparece
  // assim que os dados locais chegam e o trilho de domínio público se preenche quando o Archive responder.
  const archivePromise = searchArchive('').catch(() => ({ results: [] }));

  Promise.all([
    health(),
    listLibrary('watching'),
    getCalendar(2).catch(() => ({ entries: [] as CalendarEntryDto[] })),
    listUpNext().catch(() => ({ items: [] })),
    getStats({ year: today.getFullYear(), tz: browserTimeZone(), hpd: 1 }).catch(() => null),
  ])
    .then(([h, watching, calendar, upNext, stats]) => {
      const banner = h.tmdbEnabled
        ? ''
        : `<div class="banner warn">${icon('alert')}<span>Catálogo TMDB desligado — veja como ligar em <a href="#/connections">configurar conexões</a>. Domínio público, Telegram e sua biblioteca funcionam normalmente.</span></div>`;

      body.innerHTML = `
        ${banner}
        ${yearStripHtml(stats ? yearStrip(stats, today.getMonth()) : null)}
        <div class="section">${sectionHead('play', 'Continuar assistindo', { href: '#/library', label: 'ver biblioteca' })}<div class="rail" id="watching-rail"></div></div>
        <div class="section" id="up-next-section">${sectionHead('play', 'Próximos episódios')}<div class="rail" id="up-next-rail"></div></div>
        <div class="section">${sectionHead('calendar', 'Hoje e amanhã', { href: '#/agenda', label: 'ver agenda' })}<div id="upcoming"></div></div>
        <div class="section">${sectionHead('send', 'Novo nos canais', { href: '#/telegram', label: 'ver canais' })}<div id="feed"></div></div>
        <div class="section">${sectionHead('film', 'Domínio público', { href: '#/public-domain', label: 'ver tudo' })}<div class="rail" id="archive-rail" aria-busy="true">${RAIL_SKELETON}</div></div>
      `;

      const watchingRail = host.querySelector('#watching-rail') as HTMLElement;
      // Vídeos de canais começados vêm primeiro: é o que a pessoa largou por último.
      const resumeCards = continueWatchingCards();
      for (const card of resumeCards) watchingRail.appendChild(card);
      if (watching.items.length === 0 && resumeCards.length === 0) {
        watchingRail.innerHTML = `<div class="empty-state" style="flex:1">nada em andamento — busque algo (<kbd>${paletteKeyLabel(navigator.platform)}</kbd>) e marque como "assistindo"</div>`;
      }
      // A sincronização pode trazer posições de outro aparelho depois que a tela já renderizou.
      const onPlaybackChanged = () => {
        if (!watchingRail.isConnected) {
          window.removeEventListener(PLAYBACK_CHANGED_EVENT, onPlaybackChanged);
          return;
        }
        refreshResumeCards(watchingRail);
      };
      window.addEventListener(PLAYBACK_CHANGED_EVENT, onPlaybackChanged);
      for (const item of watching.items) {
        watchingRail.appendChild(
          renderCard({
            title: item.title.title,
            posterUrl: item.title.posterUrl,
            meta: item.currentSeason ? `T${item.currentSeason} · Ep ${item.currentEpisode}` : undefined,
            status: item.watchStatus,
            onClick: () => navigate(libraryItemPath(item)),
          }),
        );
      }

      // Sem série em andamento com episódio seguinte, a seção some em vez de mostrar um trilho vazio.
      const upNextRail = host.querySelector('#up-next-rail') as HTMLElement;
      if (upNext.items.length === 0) host.querySelector('#up-next-section')?.remove();
      for (const item of upNext.items) {
        upNextRail.appendChild(
          renderCard({
            title: item.title.title,
            posterUrl: item.title.posterUrl,
            meta: `T${item.seasonNumber} · Ep ${item.episodeNumber}${item.episodeName ? ` — ${item.episodeName}` : ''}`,
            // Com vídeo de canal vinculado, o card leva direto a ele (o vídeo é o que se assiste de fato).
            onClick: () =>
              navigate(
                item.channelVideo
                  ? watchPath(item.channelVideo.channelId, item.channelVideo.messageId)
                  : titlePath(item.title.source as CatalogSource, item.title.mediaType, item.title.sourceId),
              ),
          }),
        );
      }

      const upcoming = host.querySelector('#upcoming') as HTMLElement;
      const soon = calendar.entries.filter((e) => e.date === todayIso || e.date === tomorrowIso);
      if (soon.length === 0) {
        upcoming.innerHTML = `<div class="empty-state">nada previsto para hoje ou amanhã — <a href="#/agenda">veja a agenda completa</a></div>`;
      } else {
        upcoming.innerHTML = `<div class="calendar-list">${upcomingRows(soon, todayIso)}</div>`;
        for (const el of upcoming.querySelectorAll<HTMLElement>('.calendar-item')) {
          const { source, sourceId, media } = el.dataset;
          if (!source || !sourceId || !media) continue;
          const go = () => navigate(titlePath(source as CatalogSource, source === 'archive' ? '_' : (media as 'movie' | 'tv'), sourceId));
          el.addEventListener('click', go);
          el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') go();
          });
        }
      }

      renderTelegramFeed(host.querySelector('#feed') as HTMLElement);

      const archiveRail = host.querySelector('#archive-rail') as HTMLElement;
      void archivePromise.then((archive) => {
        // A pessoa pode ter saído da tela antes do Archive responder.
        if (!archiveRail.isConnected) return;
        archiveRail.replaceChildren();
        archiveRail.removeAttribute('aria-busy');
        if (archive.results.length === 0) {
          archiveRail.innerHTML = `<div class="empty-state" style="flex:1">acervo do Internet Archive indisponível agora — <a href="#/public-domain">tentar na página do acervo</a></div>`;
          return;
        }
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
      });
    })
    .catch(() => {
      body.innerHTML = `<div class="empty-state"><div class="big">${icon('alert')}</div>não foi possível carregar o início agora</div>`;
    });
};
