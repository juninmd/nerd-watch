import { PageHeader } from '@juninmd/sonido';

import { Fragment, useEffect, useState } from 'react';
import { type HealthResponse, health } from '../api/index.ts';
import { listSources, type SourceDto } from '../api/sources.ts';
import { navigate } from '../app/router.ts';
import { TelegramLogin } from '../channels/telegram-login.tsx';
import { resolveVersionStatus, type VersionStatus } from '../platform/version-info.ts';
import { versionLabel } from '../platform/version.ts';
import type { IconName } from '../ui/icons.ts';
import { ConnCard } from './conn-card.tsx';
import { DriveConnect } from './drive-connect.tsx';
import { SourceCard } from './source-card.tsx';
import { TraktActions } from './trakt-actions.tsx';

interface Integration {
  title: string;
  icon: IconName;
  on: boolean;
  onText: string;
  offText: string;
}

const integrations = (h: HealthResponse): Integration[] => [
  {
    title: 'Catálogo TMDB',
    icon: 'film',
    on: h.tmdbEnabled,
    onText: 'Busca de filmes, séries e novelas ativa.',
    offText: 'Defina TMDB_API_KEY no .env (chave grátis em themoviedb.org) para buscar filmes e séries. Domínio público e sua lista funcionam sem ela.',
  },
  {
    title: 'Catálogo TVmaze',
    icon: 'calendar',
    on: true,
    onText: 'Séries e datas de episódios da TVmaze: ativo, sem chave.',
    offText: 'Indisponível.',
  },
  {
    title: 'Catálogo AniList',
    icon: 'film',
    on: true,
    onText: 'Anime do AniList: ativo, sem chave.',
    offText: 'Indisponível.',
  },
  {
    title: 'Legendas (OpenSubtitles)',
    icon: 'list',
    on: h.openSubtitlesEnabled,
    onText: 'Legendas do OpenSubtitles ativas.',
    offText: 'Opcional: defina OPENSUBTITLES_API_KEY no .env. Sem ela, as legendas vêm dos addons públicos do Stremio.',
  },
  {
    title: 'Streaming P2P',
    icon: 'play',
    on: h.torrentEnabled,
    onText: 'Reprodução do acervo de domínio público via torrent ativa.',
    offText: 'Desligado neste servidor (TORRENT_ENABLED).',
  },
];

/** Desktop: a versão instalada (a mesma que o auto-update compara); no navegador, a do servidor. */
function VersionInfo() {
  const [status, setStatus] = useState<VersionStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void resolveVersionStatus().then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!status) return null;
  return (
    <p className="hint conn-version">
      {status.installed ? versionLabel(status.version) : `versão: v${status.version}`}
      {status.latest && (
        <a href={status.latest.url} target="_blank" rel="noopener noreferrer">
          Nova versão v{status.latest.version} disponível
        </a>
      )}
    </p>
  );
}

/** Central de conexões: status de cada integração, login guiado do Telegram, fontes de vídeo e Trakt. */
export function ConnectionsPage({ query }: { query: URLSearchParams }) {
  const [sources, setSources] = useState<SourceDto[] | null>(null);
  const [sourcesFailed, setSourcesFailed] = useState(false);
  const [healthInfo, setHealthInfo] = useState<HealthResponse | null>(null);
  const [healthFailed, setHealthFailed] = useState(false);
  const [traktVersion, setTraktVersion] = useState(0);

  useEffect(() => {
    // Link antigo ("/connections?focus=backup"): backup e importação agora moram em "Importar e backup".
    if (query.get('focus') === 'backup') return navigate('/data');
    let alive = true;
    listSources()
      .then((list) => alive && setSources(list.filter((s) => !s.ownCard)))
      .catch(() => alive && setSourcesFailed(true));
    health()
      .then((h) => alive && setHealthInfo(h))
      .catch(() => alive && setHealthFailed(true));
    return () => {
      alive = false;
    };
  }, [query]);

  return (
    <>
      <PageHeader titleAs="h1" title="Conexões" description="Tudo que o app usa de fora, num lugar só: o que está ligado, o que falta e como resolver." />
      <div className="conn-grid">
        <TelegramLogin />
        <DriveConnect />
        {sourcesFailed && <p className="hint">não foi possível listar as fontes de vídeo</p>}
        {/* Uma fonte de vídeo = um cartão desenhado a partir do descritor do servidor (campos, passo a passo, OAuth). */}
        {sources?.map((s) =>
          s.id === 'trakt' ? (
            // Trakt tem ações além da conexão (importar/exportar): ficam num bloco abaixo do cartão genérico.
            <Fragment key={s.id}>
              <SourceCard initial={s} onChange={() => setTraktVersion((v) => v + 1)} />
              <TraktActions version={traktVersion} />
            </Fragment>
          ) : (
            <SourceCard key={s.id} initial={s} />
          ),
        )}
        {healthFailed && <p className="hint">não foi possível consultar o estado do servidor</p>}
        {healthInfo &&
          integrations(healthInfo).map((i) => (
            <ConnCard key={i.title} icon={i.icon} title={i.title} description={i.on ? i.onText : i.offText} status={{ ok: i.on, label: i.on ? 'ativo' : 'desligado' }} />
          ))}
      </div>
      <VersionInfo />
    </>
  );
}
