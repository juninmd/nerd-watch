import { Button, EmptyState, SearchField, Select } from '@juninmd/sonido';
import { Fragment, useEffect, useState } from 'react';
import { acceptTelegramSuggestions, refreshTelegramChannel, type TelegramChannelDetailDto, type TelegramItemDto } from '../api/index.ts';
import { showToast } from '../app/state.ts';
import { canRefreshMode } from '../connections/source-modes.ts';
import { type QueueOrder, setQueueOrder } from '../player/player-dock.ts';
import { Icon } from '../ui/icon.tsx';
import { VideosFooter } from './channel-footer.tsx';
import type { ChannelList } from './channel-list.ts';
import { TopicTabs } from './channel-side.tsx';
import type { TopicTab } from './channel-topics.ts';
import { VideoItem } from './channel-video-item.tsx';
import { setListMode } from './list-mode.ts';

/** Quantos cards aparecem de cada vez: milhares de vídeos carregados não viram milhares de nós no DOM. */
export const PAGE_SIZE = 60;

/** Estado da lista que sobrevive a um recarregamento do canal (carregar mais antigos, buscar no Telegram…). */
export interface ViewState {
  q: string;
  list: boolean;
  shown: number;
  /** Aba de subgrupo ativa (`ALL` = todos agrupados). */
  topic: string;
  order: QueueOrder;
}

const ORDER_OPTIONS = [
  { value: 'newest', label: 'Mais recentes primeiro' },
  { value: 'oldest', label: 'Mais antigos primeiro' },
  { value: 'name', label: 'Nome (A–Z)' },
  { value: 'name-desc', label: 'Nome (Z–A)' },
];

interface ChannelVideosProps {
  d: TelegramChannelDetailDto;
  tabs: readonly TopicTab[];
  view: ViewState;
  patch: (next: Partial<ViewState>) => void;
  list: ChannelList<TelegramItemDto>;
  onPlay: (index: number) => void;
  reload: () => void;
}

export function ChannelVideos({ d, tabs, view, patch, list, onPlay, reload }: ChannelVideosProps) {
  const [text, setText] = useState(view.q);
  const [refreshing, setRefreshing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const remote = d.mode === 'personal' || d.mode === 'public';

  // Busca com folga de 150 ms para não refiltrar milhares de vídeos a cada tecla; limpar vale na hora.
  useEffect(() => {
    if (text === view.q) return;
    const t = setTimeout(() => patch({ q: text, shown: PAGE_SIZE }), text ? 150 : 0);
    return () => clearTimeout(t);
  }, [text, view.q, patch]);

  const refresh = () => {
    setRefreshing(true);
    refreshTelegramChannel(d.titleId)
      .then((res) => {
        showToast(`canal atualizado — ${res.itemCount} vídeo(s)`);
        reload();
      })
      .catch(() => showToast('não foi possível atualizar agora'))
      .finally(() => setRefreshing(false));
  };

  const accept = () => {
    setAccepting(true);
    acceptTelegramSuggestions(d.titleId)
      .then((res) => {
        showToast(`${res.accepted} vínculo(s) confirmado(s)`);
        reload();
      })
      .catch(() => showToast('não foi possível confirmar as sugestões agora'))
      .finally(() => setAccepting(false));
  };

  const setList = (on: boolean) => {
    if (view.list === on) return;
    setListMode(on);
    patch({ list: on });
  };

  const total = d.items.length;
  const visible = list.matches.slice(0, view.shown);
  const plural = total === 1 ? '' : 's';
  const count = view.q.trim() ? `${list.matches.length} de ${total} vídeo${plural} carregado${plural}` : total > visible.length ? `mostrando ${visible.length} de ${total}` : '';
  const suggested = d.items.filter((i) => i.link?.status === 'suggested').length;
  let lastHeading = '';

  return (
    <div>
      <div className="section-head tg-toolbar">
        <h2>Vídeos</h2>
        {total > 1 && (
          <Select
            label="Ordem dos vídeos"
            options={ORDER_OPTIONS}
            value={view.order}
            onChange={(v) => {
              setQueueOrder(v as QueueOrder);
              patch({ order: v as QueueOrder });
            }}
          />
        )}
        {total > 0 && (
          <fieldset className="tg-view-toggle">
            <legend className="sr-only">Modo de exibição</legend>
            <Button size="icon" variant={view.list ? 'ghost' : 'primary'} aria-pressed={!view.list} aria-label="Ver em grade" title="Grade" onClick={() => setList(false)}>
              <Icon name="grid" size="sm" />
            </Button>
            <Button size="icon" variant={view.list ? 'primary' : 'ghost'} aria-pressed={view.list} aria-label="Ver em lista" title="Lista" onClick={() => setList(true)}>
              <Icon name="list" size="sm" />
            </Button>
          </fieldset>
        )}
        {canRefreshMode(d.mode) && (
          <Button variant="ghost" size="sm" iconStart={<Icon name="download" size="sm" />} loading={refreshing} onClick={refresh}>
            atualizar
          </Button>
        )}
      </div>
      {d.mode === 'bot' && <p className="hint">modo bot só recebe vídeos postados a partir de agora — sem histórico retroativo.</p>}
      {suggested > 0 && (
        <section className="tg-links-bar" aria-label="Sugestões de vínculo">
          <span>{suggested} sugestão(ões) de vínculo para confirmar</span>
          <Button variant="ghost" size="sm" loading={accepting} onClick={accept}>
            aceitar sugestões
          </Button>
        </section>
      )}
      <div className="tg-search">
        <SearchField label="Buscar nos vídeos deste canal" placeholder="buscar no título e na descrição dos vídeos" autoComplete="off" value={text} onChange={setText} />
        <span className="hint" role="status" aria-live="polite">
          {count}
        </span>
      </div>
      <TopicTabs tabs={tabs} active={view.topic} total={total} onChange={(topic) => patch({ topic, shown: PAGE_SIZE })} />
      <div className={view.list ? 'tg-list' : 'tg-grid'}>
        {visible.map((item, i) => {
          const heading = list.headings.get(item.messageId);
          const showHeading = heading !== undefined && heading !== lastHeading;
          if (showHeading) lastHeading = heading;
          return (
            <Fragment key={item.messageId}>
              {showHeading && (
                <h3 className="tg-topic-head">
                  {d.title} › {heading}
                </h3>
              )}
              <VideoItem channelId={d.titleId} item={item} row={view.list} onPlay={() => onPlay(i)} onLinked={reload} />
            </Fragment>
          );
        })}
      </div>
      {total === 0 ? (
        <EmptyState
          icon={<Icon name="inbox" />}
          title={
            d.mode === 'bot' ? 'nenhum vídeo ainda — o bot precisa estar adicionado como admin do canal, e só grava o que for postado a partir de agora' : 'nenhum vídeo encontrado nesse canal ainda'
          }
        />
      ) : list.matches.length === 0 ? (
        <EmptyState
          icon={<span aria-hidden="true">🔎</span>}
          title={`nenhum vídeo com “${view.q.trim()}” entre os ${total} carregados`}
          description={remote ? 'use o botão abaixo para procurar no canal inteiro' : undefined}
        />
      ) : null}
      <div className="tg-more">
        <VideosFooter
          d={d}
          matches={list.matches.length}
          visible={visible.length}
          query={view.q}
          onShowMore={() => patch({ shown: view.shown + PAGE_SIZE })}
          onLoaded={(added) => {
            patch({ shown: view.shown + added });
            reload();
          }}
        />
      </div>
    </div>
  );
}
