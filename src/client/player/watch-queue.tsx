import type { TelegramChannelDto } from '../api/index.ts';
import { mediaUrl } from '../platform/tauri.ts';
import { Icon } from '../ui/icon.tsx';
import { formatDuration } from '../ui/time-format.ts';
import type { DockItem } from './dock-item.ts';
import { resumePoint } from './playback-store.ts';
import { savedPosition } from './playback-positions.ts';
import type { QueueOrder } from './player-prefs.ts';

/** Lista lateral da tela de reprodução: próximos vídeos, os anteriores na ordem escolhida e o próximo canal. */

function NextRow({ item, onPlay }: { item: DockItem; onPlay(): void }) {
  const length = formatDuration(item.durationSeconds);
  const saved = savedPosition(item.key);
  const resumeAt = resumePoint(saved);
  const status = saved?.done ? ' · assistido' : resumeAt !== null ? ` · parou em ${formatDuration(resumeAt)}` : '';
  return (
    <button type="button" className="next-item" onClick={onPlay}>
      <span className="next-thumb">
        {item.poster ? (
          <img className="next-thumb-img" src={mediaUrl(item.poster)} alt="" loading="lazy" decoding="async" />
        ) : (
          <Icon name="film" />
        )}
        {length && <small>{length}</small>}
      </span>
      <span className="next-text">
        <b>{item.title}</b>
        <small>
          {item.subtitle}
          {status}
        </small>
      </span>
    </button>
  );
}

const earlierHeading = (order: QueueOrder): string =>
  order === 'newest' ? 'Mais recentes' : order === 'oldest' ? 'Mais antigos' : 'Anteriores na lista';

export interface WatchQueueProps {
  queue: DockItem[];
  index: number;
  order: QueueOrder;
  nextChannel: TelegramChannelDto | null;
  onPlay(index: number): void;
  onNextChannel(): void;
}

export function WatchQueue({ queue, index, order, nextChannel, onPlay, onNextChannel }: WatchQueueProps) {
  // Antes do atual na fila = já passou na ordem escolhida; entram depois dos próximos para a lista nunca ficar vazia.
  const upcoming = queue.slice(index + 1);
  const earlier = queue.slice(0, index);
  return (
    <div>
      {upcoming.map((it, k) => (
        <NextRow key={it.key} item={it} onPlay={() => onPlay(index + 1 + k)} />
      ))}
      {earlier.length > 0 && (
        <>
          <h3 className="watch-more">{earlierHeading(order)}</h3>
          {earlier.map((it, k) => (
            <NextRow key={it.key} item={it} onPlay={() => onPlay(k)} />
          ))}
        </>
      )}
      {upcoming.length + earlier.length === 0 && <p className="hint">Este canal só tem este vídeo por enquanto.</p>}
      {nextChannel && (
        <>
          <h3 className="watch-more">Próximo canal</h3>
          <button type="button" className="next-item next-channel" onClick={onNextChannel}>
            <span className="next-thumb">
              {nextChannel.posterUrl ? (
                <img
                  className="next-thumb-img"
                  src={mediaUrl(nextChannel.posterUrl)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <Icon name="send" />
              )}
            </span>
            <span className="next-text">
              <b>{nextChannel.title}</b>
              <small>
                {nextChannel.itemCount} vídeo{nextChannel.itemCount === 1 ? '' : 's'}
              </small>
            </span>
          </button>
        </>
      )}
    </div>
  );
}
