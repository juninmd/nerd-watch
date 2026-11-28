import { Alert, Button, Carousel, EmptyState, Kbd, Skeleton } from '@juninmd/sonido';
import { useEffect, useState } from 'react';
import type { StatsSummary } from '../../server/stats/summary.ts';
import { healthSources, type SourceProbeDto } from '../api/health.ts';
import {
  type ArchiveSearchResponse,
  type CalendarEntryDto,
  type CatalogSource,
  getCalendar,
  getStats,
  type HealthResponse,
  health,
  type LibraryItemDto,
  listLibrary,
  listUpNext,
  searchArchive,
  type UpNextItemDto,
} from '../api/index.ts';
import { type AddonDto, listAddons } from '../api/stremio.ts';
import { navigate } from '../app/router.ts';
import { paletteKeyLabel } from '../app/shortcut-keys.ts';
import { TelegramFeed } from '../channels/telegram-feed.tsx';
import { watchPath } from '../channels/telegram-items.ts';
import { openPickDialog } from '../library/pick-dialog.tsx';
import { useAlive } from '../library/use-alive.ts';
import { ContinueWatchingCards, confirmClearContinueWatching } from '../player/continue-watching.tsx';
import { yearStrip } from '../stats/insights.ts';
import { Icon } from '../ui/icon.tsx';
import { posterFlag } from '../ui/poster-badges.ts';
import { PosterCard } from '../ui/poster-card.tsx';
import { addDays, browserTimeZone, localIsoDate } from '../ui/time-format.ts';
import { libraryItemPath, titlePath } from '../ui/title-link.ts';
import { heroSlides } from './home-hero.ts';
import { HomeHeroCarousel } from './home-hero-carousel.tsx';
import { AddonTile, HomeStatus, HomeUpcoming, HomeYearStrip, SectionHead } from './home-sections.tsx';
import { homeKpis, sourceRows } from './home-status.ts';

interface HomeData {
  h: HealthResponse;
  watching: LibraryItemDto[];
  entries: CalendarEntryDto[];
  upNext: UpNextItemDto[];
  stats: StatsSummary | null;
  probes: SourceProbeDto[];
}

const upNextPath = (item: UpNextItemDto): string =>
  // Com vídeo de canal vinculado, o card leva direto a ele (o vídeo é o que se assiste de fato).
  item.channelVideo
    ? watchPath(item.channelVideo.channelId, item.channelVideo.messageId)
    : titlePath(item.title.source as CatalogSource, item.title.mediaType, item.title.sourceId);

export function HomePage() {
  const [data, setData] = useState<HomeData | 'loading' | 'error'>('loading');
  const [archive, setArchive] = useState<ArchiveSearchResponse['results'] | null>(null);
  const [addons, setAddons] = useState<AddonDto[]>([]);
  const [resumeCount, setResumeCount] = useState(0);
  const alive = useAlive();
  const today = new Date();
  const todayIso = localIsoDate(today);
  const tomorrowIso = localIsoDate(addDays(today, 1));

  useEffect(() => {
    // O acervo do Internet Archive depende de rede externa: sai do caminho da primeira pintura. A tela aparece
    // assim que os dados locais chegam e o trilho de domínio público se preenche quando o Archive responder.
    void searchArchive('')
      .catch(() => ({ results: [] }))
      .then((res) => alive.current && setArchive(res.results));
    // Addon é extra: sem resposta, o resto da tela continua.
    void listAddons()
      .then((list) => alive.current && setAddons(list))
      .catch(() => undefined);
    Promise.all([
      health(),
      listLibrary('watching'),
      getCalendar(2).catch(() => ({ entries: [] as CalendarEntryDto[] })),
      listUpNext().catch(() => ({ items: [] as UpNextItemDto[] })),
      getStats({ year: today.getFullYear(), tz: browserTimeZone(), hpd: 1 }).catch(() => null),
      healthSources().catch(() => ({ sources: [] as SourceProbeDto[] })),
    ])
      .then(([h, watching, calendar, upNext, stats, probes]) => {
        if (alive.current)
          setData({
            h,
            watching: watching.items,
            entries: calendar.entries,
            upNext: upNext.items,
            stats,
            probes: probes.sources,
          });
      })
      .catch(() => alive.current && setData('error'));
  }, []);

  const body = (() => {
    if (data === 'loading') return <Skeleton label="Carregando o início…" rows={6} media />;
    if (data === 'error')
      return <EmptyState icon={<Icon name="alert" />} title="não foi possível carregar o início agora" />;
    const newByTitle = new Map(data.upNext.map((u) => [u.titleId, u.newEpisodes]));
    const slides = heroSlides(data.watching, newByTitle);
    const strip = data.stats ? yearStrip(data.stats, today.getMonth()) : null;
    return (
      <>
        {!data.h.tmdbEnabled && (
          <Alert tone="warning">
            Catálogo TMDB desligado — veja como ligar em <a href="#/connections">configurar conexões</a>. Domínio
            público, Telegram e sua biblioteca funcionam normalmente.
          </Alert>
        )}
        {slides.length > 0 && <HomeHeroCarousel slides={slides} />}
        <HomeStatus
          kpis={homeKpis({
            watching: data.watching.length,
            queued: data.upNext.length,
            entries: data.entries,
            todayIso,
          })}
          rows={sourceRows(data.h, data.probes)}
        />
        {strip && <HomeYearStrip strip={strip} />}
        <Carousel
          className="section"
          title="Continuar assistindo"
          icon={<Icon name="play" size="sm" />}
          action={
            <>
              {resumeCount > 0 && (
                <Button variant="ghost" size="sm" className="resume-clear" onClick={confirmClearContinueWatching}>
                  limpar tudo
                </Button>
              )}
              <a href="#/library">ver biblioteca</a>
            </>
          }
        >
          {/* Vídeos de canais começados vêm primeiro: é o que a pessoa largou por último. */}
          <ContinueWatchingCards onCountChange={setResumeCount} />
          {data.watching.map((item) => (
            <PosterCard
              key={item.titleId}
              title={item.title.title}
              posterUrl={item.title.posterUrl}
              meta={item.currentSeason ? `T${item.currentSeason} · Ep ${item.currentEpisode}` : undefined}
              status={item.watchStatus}
              score={item.title.voteAverage}
              flag={posterFlag(item.watchStatus, newByTitle.get(item.titleId))}
              onClick={() => navigate(libraryItemPath(item))}
            />
          ))}
          {data.watching.length === 0 && resumeCount === 0 && (
            <EmptyState
              title="nada em andamento"
              description={
                <>
                  busque algo (<Kbd>{paletteKeyLabel(navigator.platform)}</Kbd>) e marque como "assistindo"
                </>
              }
            />
          )}
        </Carousel>
        {/* Sem série em andamento com episódio seguinte, a seção some em vez de mostrar um trilho vazio. */}
        {data.upNext.length > 0 && (
          <Carousel className="section" title="Próximos episódios" icon={<Icon name="play" size="sm" />}>
            {data.upNext.map((item) => (
              <PosterCard
                key={`${item.titleId}:${item.seasonNumber}:${item.episodeNumber}`}
                title={item.title.title}
                posterUrl={item.title.posterUrl}
                meta={`T${item.seasonNumber} · Ep ${item.episodeNumber}${item.episodeName ? ` — ${item.episodeName}` : ''}`}
                flag={item.newEpisodes > 0 ? posterFlag('watching', item.newEpisodes) : null}
                onClick={() => navigate(upNextPath(item))}
              />
            ))}
          </Carousel>
        )}
        <section className="section">
          <SectionHead icon="calendar" title="Hoje e amanhã" link={{ href: '#/agenda', label: 'ver agenda' }} />
          <HomeUpcoming
            entries={data.entries.filter((e) => e.date === todayIso || e.date === tomorrowIso)}
            todayIso={todayIso}
          />
        </section>
        <TelegramFeed />
        {addons.length > 0 && (
          <Carousel
            className="section"
            title="Dos seus addons"
            icon={<Icon name="puzzle" size="sm" />}
            action={<a href="#/addons">gerenciar</a>}>
            {addons.map((addon) => (
              <AddonTile key={addon.id} addon={addon} />
            ))}
          </Carousel>
        )}
        <Carousel
          className="section"
          title="Domínio público"
          icon={<Icon name="film" size="sm" />}
          action={<a href="#/public-domain">ver tudo</a>}>
          {archive === null ? (
            <Skeleton label="Carregando o acervo…" media />
          ) : archive.length === 0 ? (
            <EmptyState
              title="acervo do Internet Archive indisponível agora"
              description={<a href="#/public-domain">tentar na página do acervo</a>}
            />
          ) : (
            archive
              .slice(0, 10)
              .map((m) => (
                <PosterCard
                  key={m.identifier}
                  title={m.title}
                  posterUrl={m.thumbnailUrl}
                  meta={m.year ?? undefined}
                  isPublicDomain
                  onClick={() => navigate(titlePath('archive', '_', m.identifier))}
                />
              ))
          )}
        </Carousel>
      </>
    );
  })();

  // O cabeçalho fica fora do corpo: o foco de teclado vai para o h1 ao abrir a tela, e trocar o h1 quando os
  // dados chegassem jogaria esse foco fora.
  return (
    <>
      <header className="view-head">
        <h1 className="view-title">Bem-vindo de volta</h1>
        <p className="view-subtitle">
          O que você está assistindo, o que sai hoje e amanhã, o que chegou nos seus canais e clássicos de domínio
          público.
        </p>
        <Button
          variant="ghost"
          className="view-head-action"
          iconStart={<Icon name="dice" size="sm" />}
          onClick={openPickDialog}
        >
          O que assistir hoje
        </Button>
      </header>
      {body}
    </>
  );
}
