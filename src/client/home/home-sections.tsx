import { Accordion, Artwork, Button, Card, EmptyState, Hero, Sparkline, StatTile } from '@juninmd/sonido';
import type { KeyboardEvent, ReactNode } from 'react';
import { addonPath } from '../addons/addon-links.ts';
import type { CalendarEntryDto, CatalogSource, LibraryItemDto } from '../api/index.ts';
import type { AddonDto } from '../api/stremio.ts';
import { navigate } from '../app/router.ts';
import type { YearStrip } from '../stats/insights.ts';
import { Icon } from '../ui/icon.tsx';
import type { IconName } from '../ui/icons.ts';
import { libraryItemPath, titlePath } from '../ui/title-link.ts';
import { heroMeta } from './home-hero.ts';
import type { HomeKpi, SourceRow } from './home-status.ts';

/** Enter ativa um cartão com role="link" (o clique já vem do Card). */
const enterKey = (go: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter') go();
};

export function SectionHead({
  icon,
  title,
  link,
  children,
}: {
  icon: IconName;
  title: string;
  link?: { href: string; label: string };
  children?: ReactNode;
}) {
  return (
    <div className="section-head">
      <h2>
        <Icon name={icon} size="sm" /> {title}
      </h2>
      {children}
      {link && <a href={link.href}>{link.label}</a>}
    </div>
  );
}

/** Destaque "Continuar": o título "assistindo" que a pessoa largou por último. */
export function HomeHero({ item }: { item: LibraryItemDto }) {
  return (
    <Hero
      title={item.title.title}
      meta={heroMeta(item)}
      actions={
        <Button variant="primary" onClick={() => navigate(libraryItemPath(item))}>
          Continuar
        </Button>
      }
      aside={
        item.title.posterUrl ? (
          <Artwork title={item.title.title} src={item.title.posterUrl} ratio="poster" />
        ) : undefined
      }
    />
  );
}

/** Faixa de números do dia e saúde das fontes: o que fazer agora e o que falta ligar, sem sair do início. */
export function HomeStatus({ kpis, rows }: { kpis: HomeKpi[]; rows: SourceRow[] }) {
  return (
    <div className="home-kpis">
      {kpis.map((k) => (
        <StatTile key={k.label} label={k.label} value={k.value} hint={k.hint} />
      ))}
      <Accordion
        className="home-sources"
        items={[
          {
            key: 'sources',
            title: `${rows.filter((r) => r.ok).length} de ${rows.length} recursos ligados`,
            content: (
              <ul>
                {rows.map((r) => (
                  <li key={r.label} className={r.ok ? 'is-ok' : 'is-off'}>
                    <span>{r.label}</span>
                    <small>{r.detail}</small>
                  </li>
                ))}
              </ul>
            ),
          },
        ]}
      />
    </div>
  );
}

/** Faixa "Seu ano": três números e as conclusões por mês, levando às estatísticas. */
export function HomeYearStrip({ strip }: { strip: YearStrip }) {
  return (
    <a className="year-strip" href="#/stats" aria-label={strip.label}>
      <span className="ys-title">
        <Icon name="chart" size="sm" /> Seu ano em {strip.year}
      </span>
      {strip.items.map((item) => (
        <span key={item.label} className="ys-item">
          <strong>{item.value}</strong>
          <span>{item.label}</span>
        </span>
      ))}
      <Sparkline className="ys-spark" data={strip.months} area />
      <span className="ys-more">
        ver estatísticas <Icon name="forward" size="sm" />
      </span>
    </a>
  );
}

const entryLine = (e: CalendarEntryDto): string =>
  e.kind === 'episode'
    ? `T${e.seasonNumber} · Ep ${e.episodeNumber}${e.episodeName ? ` — ${e.episodeName}` : ''}`
    : 'estreia do filme';

/** "Hoje e amanhã": lançamentos dos dois dias; cada linha leva à página do título. */
export function HomeUpcoming({ entries, todayIso }: { entries: CalendarEntryDto[]; todayIso: string }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="nada previsto para hoje ou amanhã"
        description={<a href="#/agenda">veja a agenda completa</a>}
      />
    );
  }
  return (
    <div className="calendar-list">
      {entries.map((e) => {
        const go = () =>
          navigate(
            titlePath(e.titleSource as CatalogSource, e.titleSource === 'archive' ? '_' : e.mediaType, e.titleSourceId),
          );
        return (
          <Card
            key={`${e.titleSource}:${e.titleSourceId}:${e.date}:${e.seasonNumber}:${e.episodeNumber}`}
            className="calendar-item"
            interactive
            padding="sm"
            role="link"
            tabIndex={0}
            onClick={go}
            onKeyDown={enterKey(go)}
          >
            <Artwork className="thumb" title={e.titleName} src={e.posterUrl ?? undefined} ratio="poster" />
            <div className="info">
              <div className="t">{e.titleName}</div>
              <div className="s">{entryLine(e)}</div>
            </div>
            <div className="s">{e.date === todayIso ? 'hoje' : 'amanhã'}</div>
          </Card>
        );
      })}
    </div>
  );
}

/** Addon instalado: atalho para o catálogo/streams dele. */
export function AddonTile({ addon }: { addon: AddonDto }) {
  const go = () => navigate(addonPath(addon.id));
  return (
    <Card
      className="addon-tile"
      interactive
      padding="sm"
      role="link"
      tabIndex={0}
      aria-label={addon.name}
      onClick={go}
      onKeyDown={enterKey(go)}
    >
      <span className="addon-logo">
        {/* O logo vem do servidor do addon: não envia o referrer. */}
        {addon.logo ? (
          <Artwork ratio="square" title={addon.name} src={addon.logo} referrerPolicy="no-referrer" />
        ) : (
          <Icon name="puzzle" />
        )}
      </span>
      <span className="addon-tile-name">{addon.name}</span>
      <span className="addon-tile-meta">
        {addon.catalogs.length > 0 ? `${addon.catalogs.length} catálogo(s)` : addon.host}
      </span>
    </Card>
  );
}
