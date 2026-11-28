import { Card } from '@juninmd/sonido';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getTitleStreams, type TitleStreamsDto, type TitleStreamsQuery } from '../api/stremio.ts';
import { currentRoute } from '../app/router.ts';
import { stopIfOnPage, stopIfOnPageIn } from '../player/player-dock.ts';
import { releaseTorrentPlayers } from '../player/torrent-player.tsx';
import { StreamGroup } from './stream-group.tsx';
import { type AddonStreamGroup as Group, type AddonStreamItem as Stream, findAddonStream } from './stream-lookup.ts';
import { type PlayState, StreamPlayer, type StreamView } from './stream-player.tsx';
import { STREAM_PREVIEW } from './stream-preview.ts';

export interface StreamPick {
  addonId: string;
  index: number;
}

export interface StreamsPanelProps extends StreamView {
  dto: TitleStreamsDto;
  /** Onde o vídeo/torrent aparece (portal). Sem ele, o painel cria um slot no topo (caso do episódio). */
  playerHost?: HTMLElement | null;
  /** Quem chama assume o clique (ex.: abrir o player dedicado); `true` = não tocar aqui. */
  onPick?: (group: Group, stream: Stream) => boolean;
  /** Fonte tocada sozinha ao montar ou ao trocar o `dto` (escolha automática do player dedicado). */
  autoPlay?: StreamPick | null;
  /**
   * Muda = outro título/episódio: limpa o player e a lista aberta. Sem ele, cada `dto` novo conta como troca.
   * Com ele, fontes que chegam depois (addon lento) entram na lista sem parar o vídeo que já toca.
   */
  resetKey?: string;
}

/** Um embed de YouTube por tela: o iframe não passa pelo player global, então tocar em outro painel fecha este. */
let clearActiveEmbed: (() => void) | null = null;

const posOf = (group: Group, index: number): number => group.streams.findIndex((s) => s.index === index);

/**
 * Lista os streams de todos os addons e toca no mesmo player do app: URL/YouTube embutidos e
 * `infoHash` no motor P2P local (o servidor reconsulta o addon pela posição, nunca pelo cliente).
 */
export function StreamsPanel({ dto, playerHost, onPick, autoPlay, resetKey, ...view }: StreamsPanelProps) {
  const [play, setPlay] = useState<PlayState | null>(null);
  const [playing, setPlaying] = useState<StreamPick | null>(null);
  /** Grupos com lista longa abertos pelo usuário; some quando chega outro `dto` (troca de episódio/título). */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const key: unknown = resetKey ?? dto;
  const [shownKey, setShownKey] = useState(key);
  const seq = useRef(0);
  const slot = useRef<HTMLElement | null>(null);

  if (shownKey !== key) {
    setShownKey(key);
    setPlay(null);
    setPlaying(null);
    setExpanded(new Set());
  }

  const clearMyEmbed = useCallback(() => setPlay((p) => (p?.kind === 'embed' ? null : p)), []);
  useEffect(
    () => () => {
      if (clearActiveEmbed === clearMyEmbed) clearActiveEmbed = null;
    },
    [clearMyEmbed],
  );

  // O vídeo global pode estar dentro do slot: sair da tela ou trocar o slot não pode deixá-lo tocando órfão.
  const slotRef = useCallback((node: HTMLElement | null) => {
    slot.current = node;
    if (!node) return;
    return () => {
      stopIfOnPageIn(node);
      releaseTorrentPlayers(node);
    };
  }, []);

  const start = (g: Group, s: Stream) => {
    stopIfOnPage();
    if (clearActiveEmbed !== clearMyEmbed) clearActiveEmbed?.();
    // Sem escopo de propósito: começar uma fonte fecha qualquer torrent da tela (um player por vez).
    releaseTorrentPlayers();
    const id = ++seq.current;
    const pick = { addonId: g.addonId, index: s.index };
    // Aviso do addon (token/cache/limite) não é conteúdo; URL ausente não tem o que tocar.
    if (s.kind === 'error' || (s.kind !== 'torrent' && !s.url)) {
      setPlay(null);
      setPlaying(null);
      return;
    }
    if (s.kind === 'youtube' && s.url) {
      clearActiveEmbed = clearMyEmbed;
      setPlay({ id, kind: 'embed', url: s.url });
    } else {
      setPlay({ id, kind: s.kind === 'torrent' ? 'torrent' : 'inline', group: g, stream: s });
    }
    setPlaying(pick);
  };

  const activate = (g: Group, s: Stream) => {
    if (onPick?.(g, s)) return;
    start(g, s);
  };

  useEffect(() => {
    if (!autoPlay) return;
    const found = findAddonStream(dto, autoPlay.addonId, autoPlay.index);
    if (!found) return;
    // Escondido na prévia: abre a lista do addon para o cartão tocando ficar visível.
    if (posOf(found.group, found.stream.index) >= STREAM_PREVIEW) setExpanded((prev) => new Set(prev).add(found.group.addonId));
    activate(found.group, found.stream);
  }, [key]);

  // Leva o foco (e a rolagem) para onde o vídeo apareceu: o botão está na outra coluna ou em outra linha.
  useEffect(() => {
    if (!play || play.kind === 'unsupported') return;
    slot.current?.focus({ preventScroll: true });
    slot.current?.scrollIntoView({ block: 'nearest' });
  }, [play]);

  const toggle = (addonId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(addonId)) next.add(addonId);
      return next;
    });

  const slotEl = (
    <section ref={slotRef} className="addon-stream-player" tabIndex={-1} aria-label="Player do stream">
      {play && (
        <StreamPlayer
          key={play.id}
          state={play}
          view={view}
          onUnsupported={() => setPlay((p) => (p?.id === play.id ? { id: play.id, kind: 'unsupported' } : p))}
          onRelease={(id) => setPlay((p) => (p?.id === id ? null : p))}
        />
      )}
    </section>
  );

  return (
    <div className="addon-streams">
      {playerHost ? createPortal(slotEl, playerHost) : slotEl}
      {dto.addons.map((g) => (
        <StreamGroup
          key={g.addonId}
          group={g}
          expanded={expanded.has(g.addonId)}
          onToggle={() => toggle(g.addonId)}
          onPlay={(s) => activate(g, s)}
          playingIndex={playing?.addonId === g.addonId ? playing.index : null}
        />
      ))}
    </div>
  );
}

export interface TitleStreamsProps {
  query: TitleStreamsQuery;
  title: string;
  posterUrl: string | null;
  /** Coluna principal do título: o vídeo não cabe no cartão lateral. */
  playerHost?: HTMLElement | null;
}

/** Addons só de streams não têm catálogo: os streams entram aqui, a partir do IMDb do título. Sem addon de stream, o card some. */
export function TitleStreams({ query, title, posterUrl, playerHost }: TitleStreamsProps) {
  const [dto, setDto] = useState<TitleStreamsDto | null>(null);
  // Chave por valor: quem chama costuma montar a consulta inline, e a identidade nova não pode refazer a busca.
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    let alive = true;
    setDto(null);
    getTitleStreams(JSON.parse(queryKey) as TitleStreamsQuery)
      .then((d) => {
        if (alive) setDto(d);
      })
      .catch(() => {
        // Falha geral (ex.: TMDB fora): sem addons instalados não há o que avisar, então o card segue oculto.
      });
    return () => {
      alive = false;
    };
  }, [queryKey]);

  if (!dto || dto.addons.length === 0) return null;
  return (
    <Card className="side-card">
      <h3>Streams dos addons</h3>
      <StreamsPanel
        dto={dto}
        title={title}
        posterUrl={posterUrl}
        route={currentRoute().path}
        playerHost={playerHost ?? null}
        captions={{
          query: title,
          ...(query.tmdbId ? { tmdbId: query.tmdbId } : {}),
          mediaType: query.mediaType,
          season: query.season ?? null,
          episode: query.episode ?? null,
        }}
      />
    </Card>
  );
}
