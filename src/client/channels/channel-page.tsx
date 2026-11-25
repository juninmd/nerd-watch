import { ConfirmButton, EmptyState } from '@juninmd/sonido';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteTelegramChannel, getTelegramChannel, refreshTelegramLinks, syncTelegramChannelMeta, type TelegramChannelDetailDto } from '../api/index.ts';
import { navigate } from '../app/router.ts';
import { showToast } from '../app/state.ts';
import { handleLabel } from '../connections/source-modes.ts';
import { StatusActions } from '../library/status-actions.tsx';
import { getQueueOrder } from '../player/player-dock.ts';
import { BackLink } from '../ui/back.tsx';
import { Icon } from '../ui/icon.tsx';
import { ChannelSkeleton } from './channel-card.tsx';
import { ChannelHero } from './channel-hero.tsx';
import { buildChannelList } from './channel-list.ts';
import { PinsCard } from './channel-side.tsx';
import { ALL, buildTopicTabs } from './channel-topics.ts';
import { ChannelVideos, PAGE_SIZE, type ViewState } from './channel-videos.tsx';
import { getListMode } from './list-mode.ts';
import { watchPath } from './telegram-items.ts';

/** Tela de um canal (Telegram ou outra fonte de vídeo): cabeçalho, vídeos com busca/abas e barra lateral. */
export function ChannelPage({ titleId }: { titleId: string }) {
  const [d, setD] = useState<TelegramChannelDetailDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [view, setView] = useState<ViewState>(() => ({
    q: '',
    list: getListMode(),
    shown: PAGE_SIZE,
    topic: ALL,
    order: getQueueOrder(),
  }));
  const loadSeq = useRef(0);
  // Já tentou sincronizar tópicos/fixadas nesta visita: não repete a cada recarregamento.
  const metaTried = useRef(false);
  const alive = useRef(true);

  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    // Recalcula o vínculo automático com a biblioteca atual antes de mostrar a lista (idempotente, sem falhar a tela).
    refreshTelegramLinks(titleId)
      .catch(() => undefined)
      .then(() => getTelegramChannel(titleId, { fillThumbs: true }))
      .then((detail) => {
        if (!alive.current || seq !== loadSeq.current) return;
        setD(detail);
        // Tópicos e fixadas vêm do Telegram: busca uma vez por visita (conta pessoal) e redesenha só se algo mudou.
        if (detail.mode === 'personal' && !detail.syncedAt && !metaTried.current) {
          metaTried.current = true;
          syncTelegramChannelMeta(titleId).then(
            () => {
              if (alive.current) load();
            },
            () => undefined,
          );
        }
      })
      .catch(() => {
        if (alive.current && seq === loadSeq.current) setFailed(true);
      });
  }, [titleId]);

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const patch = useCallback((next: Partial<ViewState>) => setView((v) => ({ ...v, ...next })), []);
  const tabs = useMemo(() => (d ? buildTopicTabs(d.items, d.topics ?? []) : []), [d]);
  const topic = view.topic !== ALL && !tabs.some((t) => t.id === view.topic) ? ALL : view.topic;
  const list = useMemo(() => buildChannelList(d?.items ?? [], view.order, topic, tabs, view.q), [d, view.order, topic, tabs, view.q]);

  if (failed && !d) return <EmptyState icon={<Icon name="alert" />} title="não foi possível carregar esse canal" />;
  if (!d) return <ChannelSkeleton />;

  // O vídeo abre na tela de reprodução, com os próximos do canal ao lado; o player fixo só vem de "Minimizar".
  const play = (from: number) => {
    const item = list.matches[from];
    if (item) navigate(watchPath(d.titleId, item.messageId));
  };

  const remove = () => {
    setDeleting(true);
    deleteTelegramChannel(d.titleId)
      .then(() => {
        showToast('canal removido');
        navigate('/telegram');
      })
      .catch((err) => {
        showToast(err instanceof Error ? err.message : 'falha ao remover');
        setDeleting(false);
      });
  };

  return (
    <>
      <BackLink href="#/telegram" label="Canais" />
      <ChannelHero d={d} topicCount={tabs.length} onPlayAll={() => play(0)} />
      <div className="detail-grid">
        <ChannelVideos d={d} tabs={tabs} view={{ ...view, topic }} patch={patch} list={list} onPlay={play} reload={load} />
        <aside className="tg-side">
          <PinsCard handle={d.handle} pins={d.pins ?? []} tabs={tabs} onTopic={(id) => patch({ topic: id, shown: PAGE_SIZE })} />
          <div className="side-card">
            <h3>Sua lista</h3>
            <StatusActions
              titleId={d.titleId}
              entryId={d.library?.id ?? null}
              watchStatus={d.library?.watch_status ?? null}
              rating={d.library?.rating ?? null}
              rewatchCount={d.library?.rewatch_count ?? 0}
              onChange={load}
            />
          </div>
          <ConfirmButton
            className="tg-delete"
            size="sm"
            ask={`Remover ${handleLabel(d.handle, d.title)} do app? Os vídeos importados e o seu status somem (o canal no Telegram não é afetado).`}
            confirmLabel="remover"
            iconStart={<Icon name="trash" size="sm" />}
            loading={deleting}
            onConfirm={remove}
          >
            remover canal
          </ConfirmButton>
        </aside>
      </div>
    </>
  );
}
