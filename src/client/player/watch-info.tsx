import { Button } from '@juninmd/sonido';
import type { TelegramChannelDetailDto } from '../api/index.ts';
import { canShareAppLink } from '../app/share-link.ts';
import { itemDescription, itemFileName } from '../channels/telegram-items.ts';
import { MODE_INFO } from '../connections/source-modes.ts';
import { mediaUrl } from '../platform/tauri.ts';
import { posterCssUrl } from '../ui/poster-css.ts';
import { Icon } from '../ui/icon.tsx';
import { formatDuration } from '../ui/time-format.ts';

type ChannelItem = TelegramChannelDetailDto['items'][number];

export interface WatchInfoProps {
  channel: TelegramChannelDetailDto;
  detail: ChannelItem;
  title: string;
  embed: boolean;
  onCopyLink(): void;
  onMinimize(): void;
}

/** Cabeçalho abaixo do vídeo: título, arquivo, canal, ações (link, minimizar, abrir na origem) e descrição. */
export function WatchInfo({ channel: d, detail, title, embed, onCopyLink, onMinimize }: WatchInfoProps) {
  const description = itemDescription(detail);
  const fileName = itemFileName(detail);
  const meta = [
    detail.postedAt ? new Date(detail.postedAt).toLocaleDateString('pt-BR') : null,
    formatDuration(detail.durationSeconds),
  ]
    .filter(Boolean)
    .join(' · ');
  const channelHref = `#/telegram/${d.titleId}`;
  return (
    <div>
      <a className="btn btn-ghost btn-sm watch-back" href={channelHref}>
        <Icon name="back" size="sm" /> voltar ao canal
      </a>
      <h1 className="watch-title">{title}</h1>
      {fileName && <p className="watch-file">arquivo: {fileName}</p>}
      <div className="watch-channel">
        {/* biome-ignore lint/a11y/useAnchorContent: avatar decorativo; o mesmo destino é o link do nome ao lado, então fica fora do teclado e do leitor */}
        <a
          className="watch-avatar"
          href={channelHref}
          style={d.posterUrl ? { backgroundImage: posterCssUrl(mediaUrl(d.posterUrl)) } : undefined}
          aria-hidden="true"
          tabIndex={-1}
        />
        <div className="watch-channel-text">
          <a href={channelHref}>
            <b>{d.title}</b>
          </a>
          <small>{meta}</small>
        </div>
        <div className="watch-actions">
          {canShareAppLink() && (
            <Button
              variant="ghost"
              size="sm"
              title="Copiar link deste vídeo"
              iconStart={<Icon name="link" size="sm" />}
              onClick={onCopyLink}
            >
              link
            </Button>
          )}
          {!embed && (
            <Button variant="ghost" size="sm" iconStart={<Icon name="minimize" size="sm" />} onClick={onMinimize}>
              Minimizar
            </Button>
          )}
          {d.link && (
            <a className="btn btn-ghost btn-sm" href={d.link} target="_blank" rel="noopener noreferrer">
              {MODE_INFO[d.mode].open}
            </a>
          )}
        </div>
      </div>
      {description && <p className="watch-desc">{description}</p>}
    </div>
  );
}
