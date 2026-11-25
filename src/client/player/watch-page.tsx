import { Button, EmptyState, Select, Skeleton, Switch } from '@juninmd/sonido';
import { useEffect, useMemo, useState } from 'react';
import {
  getTelegramChannel,
  listTelegramChannels,
  type TelegramChannelDetailDto,
  type TelegramChannelDto,
} from '../api/index.ts';
import { parseStartTime, startSecond } from '../app/deep-link.ts';
import { navigate } from '../app/router.ts';
import { copyAppLink } from '../app/share-link.ts';
import { orderItems, pickNextChannel, toDockItem, watchPath } from '../channels/telegram-items.ts';
import { Icon } from '../ui/icon.tsx';
import { resumePoint } from './playback-store.ts';
import {
  getAutoplay,
  getNowPlaying,
  getQueueOrder,
  getVideo,
  minimizePlayer,
  playIndex,
  type QueueOrder,
  savedPosition,
  setAutoplay,
  setQueueOrder,
  showInPage,
  subscribeEnded,
} from './player-dock.ts';
import { usePlayerChange } from './player-events.ts';
import { PlayerStage } from './player-stage.tsx';
import { useEndCountdown, WatchEndCard } from './watch-end-card.tsx';
import { EmbedFrame } from './watch-embed.tsx';
import { playerKindOf } from './watch-embed.ts';
import { WatchInfo } from './watch-info.tsx';
import { WatchQueue } from './watch-queue.tsx';

const NEXT_CHANNEL_COUNTDOWN = 8;

const ORDER_OPTIONS = [
  { value: 'newest', label: 'Mais recentes primeiro' },
  { value: 'oldest', label: 'Mais antigos primeiro' },
  { value: 'name', label: 'Nome (A–Z)' },
  { value: 'name-desc', label: 'Nome (Z–A)' },
];

/** Vídeo retrato (9:16 etc.) ganha um palco com a proporção dele em vez de faixas pretas enormes. */
const stageShape = (embed: boolean): { portrait: boolean; ratio: string | undefined } => {
  const v = getVideo();
  if (embed || !v?.videoWidth || !v.videoHeight) return { portrait: false, ratio: undefined };
  const portrait = v.videoHeight > v.videoWidth;
  return { portrait, ratio: portrait ? `${v.videoWidth} / ${v.videoHeight}` : undefined };
};

interface WatchViewProps {
  d: TelegramChannelDetailDto;
  channels: TelegramChannelDto[];
  messageId: string;
  startAt: number | null;
}

function WatchView({ d, channels, messageId, startAt }: WatchViewProps) {
  usePlayerChange();
  const [order, setOrder] = useState<QueueOrder>(getQueueOrder);
  const [autoplay, setAutoplayState] = useState(getAutoplay);
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const [, setMetaTick] = useState(0);
  const queue = useMemo(() => orderItems(d.items, order).map((item) => toDockItem(d, item)), [d, order]);
  const nextChannel = useMemo(() => pickNextChannel(channels, d.titleId), [channels, d.titleId]);
  // "start" = o primeiro vídeo na ordem escolhida (usado ao pular para outro canal).
  const [start] = useState(() =>
    queue.findIndex((i) => i.messageId === (messageId === 'start' ? queue[0]?.messageId : messageId)),
  );
  const goNextChannel = () => nextChannel && navigate(watchPath(nextChannel.titleId, 'start'));
  const end = useEndCountdown(goNextChannel);

  // abre a fila uma vez, quando o palco nasce; a ordem tem efeito próprio
  useEffect(() => {
    if (stage && start >= 0) showInPage(queue, start, stage, { startAt });
  }, [stage]);

  useEffect(() => {
    const video = getVideo();
    const onMeta = () => setMetaTick((n) => n + 1);
    video?.addEventListener('loadedmetadata', onMeta);
    video?.addEventListener('play', end.stop);
    // Acabaram os vídeos do canal: sugere o próximo (com contagem, se a reprodução automática estiver ligada).
    const unsubscribe = subscribeEnded(() => nextChannel && end.start(NEXT_CHANNEL_COUNTDOWN, getAutoplay()));
    return () => {
      unsubscribe();
      video?.removeEventListener('loadedmetadata', onMeta);
      video?.removeEventListener('play', end.stop);
      // Um iframe escondeu o vídeo: o próximo palco (outra tela) precisa dele visível.
      if (video) video.hidden = false;
    };
  }, [nextChannel, end.start, end.stop]);

  const now = getNowPlaying();
  const detail = now ? d.items.find((i) => i.messageId === now.item.messageId) : undefined;
  const embed = now ? playerKindOf(now.item) === 'embed' : false;

  // Item de embed: o iframe ocupa o palco e o `<video>` some. Mantém a barra do navegador no vídeo atual.
  useEffect(() => {
    if (!now || !detail) return;
    const video = getVideo();
    if (video) video.hidden = embed;
    document.title = `${now.item.title} — nerd-watch`;
    history.replaceState(null, '', `#${watchPath(d.titleId, now.item.messageId)}`);
  });

  if (start < 0) {
    return (
      <EmptyState
        icon={<Icon name="film" />}
        title="vídeo não encontrado neste canal"
        action={<a href={`#/telegram/${d.titleId}`}>voltar ao canal</a>}
      />
    );
  }

  const changeOrder = (value: string) => {
    const next = value as QueueOrder;
    setQueueOrder(next);
    setOrder(next);
    // Trocar a ordem refaz a fila mantendo o vídeo atual (e o tempo dele) como está.
    const reordered = orderItems(d.items, next).map((item) => toDockItem(d, item));
    const playing = getNowPlaying()?.item.messageId;
    if (stage)
      showInPage(
        reordered,
        Math.max(
          0,
          reordered.findIndex((i) => i.messageId === playing),
        ),
        stage,
      );
  };

  const copyLink = () => {
    if (!now) return;
    const at = startSecond(getVideo()?.currentTime ?? null, resumePoint(savedPosition(now.item.key)));
    copyAppLink(watchPath(d.titleId, now.item.messageId), { at, label: 'Link do vídeo' });
  };

  const shape = stageShape(embed);
  const left = end.end?.left ?? null;
  return (
    <div className="watch">
      <div className="watch-main">
        <PlayerStage
          onStage={setStage}
          className={shape.portrait ? 'portrait' : undefined}
          style={shape.ratio ? { aspectRatio: shape.ratio } : undefined}
        >
          {embed && now?.item.embedUrl && (
            <div className="watch-embed">
              <EmbedFrame key={now.item.embedUrl} url={now.item.embedUrl} title={now.item.title} />
            </div>
          )}
          {end.end && nextChannel && (
            <WatchEndCard
              caption={`Fim dos vídeos de ${d.title}`}
              title={`Próximo canal: ${nextChannel.title}`}
              countText={left !== null ? `começa em ${left}s` : ''}
              onGo={goNextChannel}
              onStay={end.stop}
            />
          )}
        </PlayerStage>
        {embed && now && now.index + 1 < now.queue.length && (
          <div className="watch-embed-bar">
            <Button variant="primary" size="sm" onClick={() => playIndex(now.index + 1)}>
              Próximo vídeo
            </Button>
          </div>
        )}
        {now && detail && (
          <WatchInfo
            channel={d}
            detail={detail}
            title={now.item.title}
            embed={embed}
            onCopyLink={copyLink}
            onMinimize={() => {
              minimizePlayer();
              navigate(`/telegram/${d.titleId}`);
            }}
          />
        )}
      </div>
      <aside className="watch-next" aria-label="Próximos vídeos">
        <div className="watch-next-head">
          <h2>Próximos vídeos</h2>
          <Switch
            label="reprodução automática"
            checked={autoplay}
            onChange={(on) => {
              setAutoplay(on);
              setAutoplayState(on);
            }}
          />
        </div>
        <Select
          className="watch-order"
          label="Ordem"
          aria-label="Ordem da fila de vídeos"
          options={ORDER_OPTIONS}
          value={order}
          onChange={changeOrder}
        />
        {now && (
          <WatchQueue
            queue={now.queue}
            index={now.index}
            order={order}
            nextChannel={nextChannel}
            onPlay={playIndex}
            onNextChannel={goNextChannel}
          />
        )}
      </aside>
    </div>
  );
}

type Load =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; d: TelegramChannelDetailDto; channels: TelegramChannelDto[] };

/** Tela de reprodução (estilo YouTube): vídeo grande, dados do canal, próximos vídeos e o próximo canal. */
export function WatchPage({
  channelId,
  messageId,
  query,
}: {
  channelId: string;
  messageId: string;
  query: URLSearchParams;
}) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const startAt = parseStartTime(query.get('t'));
  useEffect(() => {
    let alive = true;
    Promise.all([
      getTelegramChannel(channelId),
      listTelegramChannels().then(
        (r) => r.channels,
        () => [] as TelegramChannelDto[],
      ),
    ])
      .then(([d, channels]) => alive && setLoad({ kind: 'ready', d, channels }))
      .catch(() => alive && setLoad({ kind: 'error' }));
    return () => {
      alive = false;
    };
  }, [channelId]);

  if (load.kind === 'loading') return <Skeleton media label="carregando o vídeo" />;
  if (load.kind === 'error')
    return <EmptyState icon={<Icon name="alert" />} title="não foi possível carregar este vídeo" />;
  return <WatchView d={load.d} channels={load.channels} messageId={messageId} startAt={startAt} />;
}
