import { Avatar, Badge, Button, Hero } from '@juninmd/sonido';
import type { TelegramChannelDetailDto } from '../api/index.ts';
import { canShareAppLink, copyAppLink } from '../app/share-link.ts';
import { MODE_INFO } from '../connections/source-modes.ts';
import { mediaUrl } from '../platform/tauri.ts';
import { Icon } from '../ui/icon.tsx';

interface ChannelHeroProps {
  d: TelegramChannelDetailDto;
  topicCount: number;
  onPlayAll: () => void;
}

/** Cabeçalho do canal: foto, selo da origem, contagens, descrição e ações (tocar tudo, copiar link, abrir na origem). */
export function ChannelHero({ d, topicCount, onPlayAll }: ChannelHeroProps) {
  const poster = d.posterUrl ? mediaUrl(d.posterUrl) : undefined;
  const share = canShareAppLink();
  const meta = (
    <>
      <span className="hero-meta">
        <Badge tone="violet">{MODE_INFO[d.mode].badge}</Badge>
        <span>
          {d.itemCount} vídeo{d.itemCount === 1 ? '' : 's'}
        </span>
        {topicCount > 0 && (
          <span>
            {topicCount} subgrupo{topicCount === 1 ? '' : 's'}
          </span>
        )}
        {d.link && (
          <a className="tg-link" href={d.link} target="_blank" rel="noopener noreferrer">
            {d.link.replace('https://', '')}
          </a>
        )}
      </span>
      {d.description && <span className="hero-overview tg-description">{d.description}</span>}
    </>
  );
  const actions =
    d.items.length || d.link || share ? (
      <>
        {d.items.length > 0 && (
          <Button variant="primary" iconStart={<Icon name="play" size="sm" />} onClick={onPlayAll}>
            Reproduzir tudo
          </Button>
        )}
        {share && (
          <Button variant="ghost" title="Copiar link deste canal no app" iconStart={<Icon name="link" size="sm" />} onClick={() => copyAppLink(`/telegram/${d.titleId}`, { label: 'Link do canal' })}>
            copiar link
          </Button>
        )}
        {d.link && (
          <Button variant="ghost" href={d.link} target="_blank" rel="noopener noreferrer">
            {MODE_INFO[d.mode].open}
          </Button>
        )}
      </>
    ) : undefined;
  return <Hero className="tg-hero" title={d.title} backdrop={poster} meta={meta} actions={actions} aside={poster ? <Avatar name={d.title} src={poster} size={112} ring /> : undefined} />;
}
