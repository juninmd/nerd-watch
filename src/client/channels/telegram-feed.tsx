import { Button, Carousel, EmptyState, Skeleton } from '@juninmd/sonido';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listRecentTelegramItems, type TelegramRecentItemDto } from '../api/index.ts';
import { navigate } from '../app/router.ts';
import { showToast } from '../app/state.ts';
import { Icon } from '../ui/icon.tsx';
import { PosterCard } from '../ui/poster-card.tsx';
import { formatDuration } from '../ui/time-format.ts';
import { feedSyncGate, syncAllChannels } from './feed-sync.ts';
import { itemTitle, watchPath } from './telegram-items.ts';

/** Quantos vídeos o carrossel mostra: é o teto que o servidor aceita em `/api/telegram/recent`. */
export const FEED_LIMIT = 50;

const TITLE = 'Novo nos canais';

const titleOf = (item: TelegramRecentItemDto): string => (item.caption?.trim() ? itemTitle(item) : item.channelTitle);

export interface TelegramFeedProps {
  limit?: number;
  /** Sem vídeos, a seção inteira some (tela de canais); no início ela convida a adicionar um canal. */
  hideWhenEmpty?: boolean;
  /** Link "ver canais" no cabeçalho; a própria tela de canais o desliga. */
  channelsLink?: boolean;
}

/** Seção "novo nos canais" com os vídeos mais recentes: cada cartão abre o vídeo na tela de reprodução do canal dele. */
export function TelegramFeed({ limit = FEED_LIMIT, hideWhenEmpty = false, channelsLink = true }: TelegramFeedProps) {
  const [items, setItems] = useState<TelegramRecentItemDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  /** Só relê o que já está no banco local: barato, e é o que mostra o resultado de uma rodada de sincronização. */
  const load = useCallback(
    (): Promise<void> =>
      listRecentTelegramItems(limit)
        .then((res) => {
          if (alive.current) setItems(res.items);
        })
        // Em atualização silenciosa, manter a lista antiga é melhor que trocá-la por um erro.
        .catch(() => {
          if (alive.current) setFailed(true);
        }),
    [limit],
  );

  /** Lê os canais no Telegram e repinta. `manual` ignora o intervalo mínimo e avisa o resultado. */
  const refresh = useCallback(
    async (manual: boolean): Promise<void> => {
      if (!alive.current || !feedSyncGate.tryStart(manual)) return;
      setBusy(true);
      try {
        const { failed: n } = await syncAllChannels();
        if (manual && n > 0) showToast(`${n} canal(is) não puderam ser atualizados agora`);
        else if (manual) showToast('vídeos atualizados');
      } catch {
        if (manual) showToast('não foi possível atualizar agora');
      } finally {
        feedSyncGate.finish();
        if (alive.current) setBusy(false);
      }
      if (alive.current) await load();
    },
    [load],
  );

  useEffect(() => {
    alive.current = true;
    void load().then(() => refresh(false));
    // Voltar à aba/janela: o gate garante o intervalo mínimo.
    const onReturn = () => void refresh(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') onReturn();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onReturn);
    return () => {
      alive.current = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onReturn);
    };
  }, [load, refresh]);

  if (items?.length === 0 && hideWhenEmpty) return null;

  const actions = (
    <span className="section-head-actions">
      <Button variant="ghost" size="sm" aria-label="Atualizar vídeos dos canais" iconStart={<Icon name="refresh" size="sm" />} loading={busy} onClick={() => void refresh(true)}>
        atualizar
      </Button>
      {channelsLink && <a href="#/telegram">ver canais</a>}
    </span>
  );

  if (items === null && failed) {
    return (
      <section className="section">
        <div className="section-head">
          <h2>{TITLE}</h2>
          {actions}
        </div>
        <EmptyState icon={<Icon name="alert" />} title="não foi possível carregar os vídeos dos canais" />
      </section>
    );
  }

  if (items?.length === 0) {
    return (
      <section className="section">
        <div className="section-head">
          <h2>{TITLE}</h2>
          {actions}
        </div>
        <EmptyState
          icon={<Icon name="send" />}
          title="nenhum vídeo de canal ainda"
          description={
            <>
              <a href="#/telegram">adicione um canal</a> ou <a href="#/connections">conecte sua conta</a>
            </>
          }
        />
      </section>
    );
  }

  const n = items?.length ?? 0;
  return (
    <div className="section">
      <Carousel title={TITLE} action={actions} itemWidth={168}>
        {items === null
          ? Array.from({ length: 5 }, (_, i) => <Skeleton key={`s${i}`} media rows={1} label={i === 0 ? 'carregando vídeos dos canais' : undefined} />)
          : items.map((item) => (
              <PosterCard
                key={`${item.channelId}:${item.messageId}`}
                title={titleOf(item)}
                posterUrl={item.thumbnailUrl}
                meta={[item.channelTitle, formatDuration(item.durationSeconds)].filter(Boolean).join(' · ')}
                onClick={() => navigate(watchPath(item.channelId, item.messageId))}
              />
            ))}
      </Carousel>
      {n > 0 && (
        <p className="hint">
          {n} vídeo{n === 1 ? '' : 's'} mais recente{n === 1 ? '' : 's'} dos seus canais
        </p>
      )}
    </div>
  );
}
