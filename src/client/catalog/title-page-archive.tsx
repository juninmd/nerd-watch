import { Badge, Button } from '@juninmd/sonido';
import { useEffect, useState } from 'react';
import { type ArchiveDetailDto, getArchiveTitle } from '../api/index.ts';
import { StatusActions } from '../library/status-actions.tsx';
import { InlinePlayer } from '../player/inline-player.tsx';
import { parkPlayer, stopIfOnPage } from '../player/player-dock.ts';
import { SubtitlesPanel } from '../player/subtitles.tsx';
import { TorrentPanel } from '../player/torrent-player.tsx';
import { BackLink } from '../ui/back.tsx';
import { titlePath } from '../ui/title-link.ts';
import { LinkButton, SideCard } from './side-card.tsx';
import { TitleError, TitleSkeleton } from './title-error.tsx';
import { TitleHero } from './title-hero.tsx';
import { useLoad } from './use-load.ts';

type PlayerMode = { kind: 'app'; src: string } | { kind: 'embed'; reason: string };

/** Player do app por padrão quando o item tem MP4/WebM; sem arquivo compatível (ou se o navegador não tocar), o embed da Archive. */
function ArchivePlayer({ d }: { d: ArchiveDetailDto }) {
  const [mode, setMode] = useState<PlayerMode>(
    d.directVideoUrl ? { kind: 'app', src: d.directVideoUrl } : { kind: 'embed', reason: '' },
  );
  const src = d.directVideoUrl;
  const toEmbed = (reason: string) => {
    stopIfOnPage();
    setMode({ kind: 'embed', reason });
  };
  return (
    <>
      {mode.kind === 'app' ? (
        <InlinePlayer
          item={{
            key: `archive:${d.identifier}`,
            src: mode.src,
            title: d.title,
            subtitle: 'Internet Archive',
            poster: d.posterUrl,
            channelId: 'archive',
            messageId: d.identifier,
            durationSeconds: null,
            route: titlePath('archive', '_', d.identifier),
            captions: {
              query: `${d.title} ${d.year ?? ''}`.trim(),
              archiveId: d.identifier,
              archiveHasSubtitle: Boolean(d.subtitleUrl),
            },
          }}
          minimizable
          onUnsupported={() =>
            toEmbed('O seu navegador não tocou este arquivo no player do app; usando o player da Archive.org.')
          }
        />
      ) : (
        <div className="player-frame">
          <iframe src={d.embedUrl} allowFullScreen title={d.title} />
        </div>
      )}
      <p className="view-subtitle archive-note">
        Reprodução direta do Internet Archive — este título está em domínio público, sem custo e 100% legal.{' '}
        {mode.kind === 'app' && (
          <Button variant="link" size="sm" onClick={() => toEmbed('')}>
            Usar o player do Archive.org
          </Button>
        )}
        {mode.kind === 'embed' && mode.reason}
        {/* Escolha do usuário (sem erro): dá para voltar ao player do app. */}
        {mode.kind === 'embed' && !mode.reason && src && (
          <Button variant="link" size="sm" onClick={() => setMode({ kind: 'app', src })}>
            Usar o player do app
          </Button>
        )}
      </p>
    </>
  );
}

/** Ficha de um item de domínio público do Internet Archive, com player, torrent oficial e legendas. */
export function ArchiveTitle({ identifier }: { identifier: string }) {
  const { data: d, error, retry, reload } = useLoad(() => getArchiveTitle(identifier), identifier);
  useEffect(() => parkPlayer(), []);
  if (error) return <TitleError onRetry={retry} />;
  if (!d) return <TitleSkeleton />;
  const query = `${d.title} ${d.year ?? ''}`.trim();
  return (
    <div>
      <BackLink href="#/library" label="Voltar" useHistory />
      <TitleHero
        title={d.title}
        posterUrl={d.posterUrl}
        meta={[
          <Badge tone="gold" key="pd">
            domínio público
          </Badge>,
          d.year ? String(d.year) : null,
          'Internet Archive',
        ]}
        overview={d.overview || 'Sem sinopse disponível para este item.'}
      />
      <div className="detail-grid">
        <div>
          <div className="section-head">
            <h2>Assistir agora, dentro do app</h2>
          </div>
          <ArchivePlayer d={d} />
        </div>
        <div>
          <SideCard title="Sua lista">
            <StatusActions
              titleId={d.titleId}
              entryId={d.library?.id ?? null}
              watchStatus={d.library?.watch_status ?? null}
              rating={d.library?.rating ?? null}
              rewatchCount={d.library?.rewatch_count ?? 0}
              onChange={reload}
            />
          </SideCard>
          <SideCard title="Baixar" className="side-card--stack">
            <LinkButton href={d.torrentUrl} icon="download" block>
              torrent oficial (Internet Archive)
            </LinkButton>
            <LinkButton href={d.detailsUrl} icon="forward" block>
              página no archive.org
            </LinkButton>
          </SideCard>
          <SideCard title="Assistir por P2P">
            {d.hasPlayableVideo === false ? (
              <p className="hint">
                este item da Archive só tem formatos que o navegador não toca (OGV/AVI). Baixe pelo torrent ao lado para
                ver num player de vídeo.
              </p>
            ) : (
              <TorrentPanel identifier={d.identifier} title={d.title} posterUrl={d.posterUrl} />
            )}
          </SideCard>
          <SideCard title="Legendas" className="side-card--stack">
            {d.subtitleUrl && (
              <LinkButton href={d.subtitleUrl} icon="download" variant="primary" block>
                legenda hospedada na Archive.org
              </LinkButton>
            )}
            <SubtitlesPanel query={query} />
          </SideCard>
        </div>
      </div>
    </div>
  );
}
