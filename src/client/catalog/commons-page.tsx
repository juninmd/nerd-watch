import { Badge, Card, EmptyState, Skeleton } from '@juninmd/sonido';
import { useEffect, useState } from 'react';
import { type CommonsVideoDto, getCommonsVideo } from '../api/index.ts';
import { InlinePlayer } from '../player/inline-player.tsx';
import { parkPlayer } from '../player/player-dock.ts';
import { BackButton } from '../ui/back.tsx';
import { Icon } from '../ui/icon.tsx';

function CommonsVideo({ v }: { v: CommonsVideoDto }) {
  const [note, setNote] = useState('');
  return (
    <>
      <header className="view-head">
        <BackButton fallback="/public-domain" />
        <h1 className="view-title">{v.name}</h1>
        <p className="view-subtitle">
          <Badge tone="gold">{v.license}</Badge> Wikimedia Commons{v.author ? ` · ${v.author}` : ''}
        </p>
      </header>
      <div className="detail-grid">
        <div>
          <InlinePlayer
            item={{
              key: `commons:${v.title}`,
              src: v.videoUrl,
              title: v.name,
              subtitle: 'Wikimedia Commons',
              poster: v.thumbnailUrl,
              channelId: 'commons',
              messageId: v.title,
              durationSeconds: null,
              route: `/commons/${encodeURIComponent(v.title)}`,
              captions: { query: v.name },
            }}
            minimizable
            onUnsupported={() =>
              setNote('O navegador não tocou este formato (comum em .ogv); use "baixar o arquivo" ou abra no Commons.')
            }
          />
          <p className="hint">{note}</p>
          <p>{v.description || 'Sem descrição disponível.'}</p>
        </div>
        <div>
          <Card className="side-card">
            <h3>Licença e origem</h3>
            <p>
              {v.licenseUrl ? (
                <a href={v.licenseUrl} target="_blank" rel="noopener noreferrer">
                  {v.license}
                </a>
              ) : (
                v.license
              )}
            </p>
            <a className="btn btn-ghost btn-sm commons-link" href={v.pageUrl} target="_blank" rel="noopener noreferrer">
              <Icon name="forward" size="sm" /> página no Commons
            </a>
            <a
              className="btn btn-ghost btn-sm commons-link"
              href={v.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              download
            >
              <Icon name="download" size="sm" /> baixar o arquivo
            </a>
          </Card>
        </div>
      </div>
    </>
  );
}

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; v: CommonsVideoDto };

/** Vídeo do Wikimedia Commons (domínio público ou licença livre) no player do app, com licença e origem ao lado. */
export function CommonsPage({ title }: { title: string }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  useEffect(() => {
    parkPlayer();
    let alive = true;
    getCommonsVideo(title)
      .then((v) => alive && setLoad({ kind: 'ready', v }))
      .catch(() => alive && setLoad({ kind: 'error' }));
    return () => {
      alive = false;
    };
  }, [title]);

  if (load.kind === 'ready') return <CommonsVideo v={load.v} />;
  return (
    <>
      <BackButton fallback="/public-domain" />
      {load.kind === 'loading' ? (
        <Skeleton media label="carregando o vídeo" />
      ) : (
        <div role="alert">
          <EmptyState icon={<Icon name="alert" />} title="vídeo indisponível no Commons agora" />
        </div>
      )}
    </>
  );
}
