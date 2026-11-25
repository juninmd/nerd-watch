import { Button } from '@juninmd/sonido';
import type { TelegramItemDto } from '../api/index.ts';
import { canShareAppLink, copyAppLink } from '../app/share-link.ts';
import { resumePoint } from '../player/playback-store.ts';
import { savedPosition } from '../player/player-dock.ts';
import { Icon } from '../ui/icon.tsx';
import { VideoCard } from './channel-card.tsx';
import { LinkBadge, openLinkDialog } from './telegram-link.tsx';
import { itemTitle, needsTitleLink, watchPath } from './telegram-items.ts';

interface VideoItemProps {
  channelId: string;
  item: TelegramItemDto;
  row: boolean;
  onPlay: () => void;
  onLinked: () => void;
}

/** Vídeo da lista com os controles fora do card (que já é um botão de reprodução): nada de controle dentro de controle. */
export function VideoItem({ channelId, item, row, onPlay, onLinked }: VideoItemProps) {
  const saved = savedPosition(`${channelId}:${item.messageId}`);
  const resumeAt = resumePoint(saved);
  const title = itemTitle(item);
  const share = canShareAppLink();
  const bind = needsTitleLink(item);
  return (
    <div className="tg-item">
      <VideoCard item={item} resumeAt={resumeAt} watched={saved?.done === true} row={row} onPlay={onPlay} />
      {(item.link || share || bind) && (
        <div className="tg-item-link">
          <LinkBadge link={item.link ?? null} />
          {share && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`copiar link de “${title}”`}
              iconStart={<Icon name="link" size="sm" />}
              onClick={() => copyAppLink(watchPath(channelId, item.messageId), { at: resumeAt, label: 'Link do vídeo' })}
            >
              link
            </Button>
          )}
          {bind && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`vincular “${title}” a um título`}
              onClick={() => openLinkDialog({ channelId, messageId: item.messageId, current: item.link ?? null, onDone: onLinked })}
            >
              {item.link ? 'alterar vínculo' : 'vincular a um título'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
