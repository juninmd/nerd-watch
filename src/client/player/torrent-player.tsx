import { Badge, Button, Select, Skeleton } from '@juninmd/sonido';
import { useEffect, useRef, useState } from 'react';
import {
  closeTorrent,
  getTorrentStatus,
  health,
  openTorrent,
  type TorrentOpenResponse,
  type TorrentStatusDto,
} from '../api/index.ts';
import { Icon } from '../ui/icon.tsx';
import { titlePath } from '../ui/title-link.ts';
import { InlinePlayer } from './inline-player.tsx';
import type { CaptionContext } from './player-captions-model.ts';
import { getNowPlaying, stopPlayer } from './player-dock.ts';

const POLL_MS = 2000;

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
};

/**
 * Registrar o cleanup aqui (em vez de no router) resolve o vazamento: sem isso, navegar para
 * outra tela deixaria o torrent aberto semeando e o `setInterval` de status rodando pra sempre.
 */
const cleanups = new Map<() => void, HTMLElement>();

/**
 * Fecha torrents e mata os pollers. Sem `root`, vale para a tela inteira (troca de rota); com `root`,
 * só os painéis dentro daquele nó (trocou a temporada ou fechou um episódio).
 */
export const releaseTorrentPlayers = (root?: Node): void => {
  for (const [cleanup, panel] of [...cleanups]) {
    if (!root || root.contains(panel)) cleanup();
  }
};

export interface TorrentPanelOptions {
  identifier: string;
  title: string;
  posterUrl?: string | null;
  /** Como abrir o torrent. Padrão: item do Internet Archive pelo `identifier`; addons passam o opener deles. */
  open?: (fileIndex?: number) => Promise<TorrentOpenResponse>;
  /** Rótulo sob o título no player (de onde vieram os bytes). */
  sourceLabel?: string;
  /** Rodapé do botão inicial: o que o usuário está prestes a fazer. */
  hint?: string;
  /** Identidade no player global e rota de retorno (o Archive usa o título; addon usa o item do addon). */
  player?: { channelId: string; messageId: string; route: string };
  /** Inicia o torrent logo ao montar (ex.: quando o usuário acabou de clicar num stream de addon). */
  autoStart?: boolean;
  /** Contexto de legendas para o player (o addon pode publicar faixas próprias para o stream). */
  captions?: CaptionContext | null;
  /** Chamado quando o painel é liberado (troca de fonte, re-render ou rota) para limpar o DOM que o hospeda. */
  onRelease?: () => void;
}

const ARCHIVE_HINT =
  'Conecta direto nos peers que hospedam o torrent oficial da Internet Archive — não passa pela banda do archive.org.';

type View =
  | { kind: 'checking' }
  | { kind: 'disabled' }
  | { kind: 'idle'; message: string }
  | { kind: 'loading'; message: string }
  | { kind: 'playing'; result: TorrentOpenResponse };

function TorrentStats({ status, lost }: { status: TorrentStatusDto | null; lost: boolean }) {
  if (lost) return <div className="torrent-stats">perdemos o torrent — use "parar" e tente de novo</div>;
  if (!status) return <div className="torrent-stats">conectando aos peers...</div>;
  return (
    <div className="torrent-stats">
      <Badge>{`${status.numPeers} peer${status.numPeers === 1 ? '' : 's'}`}</Badge>
      <Badge>{`${formatBytes(status.downloadSpeed)}/s`}</Badge>
      <Badge>{`${(status.progress * 100).toFixed(1)}% baixado`}</Badge>
      <Badge>{`${formatBytes(status.downloaded)} de ${formatBytes(status.totalLength)}`}</Badge>
    </div>
  );
}

/** Painel P2P: botão para abrir o torrent, escolha do arquivo, o player do app e o estado dos peers. */
export function TorrentPanel(opts: TorrentPanelOptions) {
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ kind: 'checking' });
  const [status, setStatus] = useState<TorrentStatusDto | null>(null);
  const [lost, setLost] = useState(false);
  // Estado que sobrevive aos renders e é lido pelos callbacks assíncronos (sequência, torrent aberto, chave no player).
  const live = useRef({ infoHash: null as string | null, playerKey: null as string | null, disposed: false, seq: 0 });
  const optsRef = useRef(opts);
  optsRef.current = opts;

  /** Para a reprodução (player). NÃO fecha o torrent: trocar de derivado o reaproveita. */
  const stopPlayback = (): void => {
    const s = live.current;
    if (s.playerKey && getNowPlaying()?.item.key === s.playerKey) stopPlayer();
    s.playerKey = null;
  };

  /** Para tudo e fecha o torrent no servidor: para de baixar/semear e libera o disco. */
  const releaseTorrent = (): void => {
    const infoHash = live.current.infoHash;
    live.current.infoHash = null;
    stopPlayback();
    if (infoHash) closeTorrent(infoHash).catch(() => {});
  };

  const start = async (fileIndex?: number): Promise<void> => {
    const s = live.current;
    const seq = ++s.seq;
    stopPlayback();
    setView({
      kind: 'loading',
      message: fileIndex === undefined ? 'buscando a metadata do torrent e os peers...' : 'trocando de arquivo...',
    });
    const o = optsRef.current;
    const open = o.open ?? ((i?: number) => openTorrent(o.identifier, i));
    try {
      const result = await open(fileIndex);
      if (s.disposed || seq !== s.seq) {
        if (s.disposed || result.infoHash !== s.infoHash) closeTorrent(result.infoHash).catch(() => {});
        return;
      }
      s.infoHash = result.infoHash;
      s.playerKey = `torrent:${result.infoHash}:${result.selected.index}`;
      setStatus(null);
      setLost(false);
      setView({ kind: 'playing', result });
    } catch (err) {
      if (s.disposed || seq !== s.seq) return;
      // A mensagem fica visível: a falha nunca é silenciosa (o botão volta com o motivo em cima).
      setView({ kind: 'idle', message: err instanceof Error ? err.message : 'não foi possível abrir o torrent' });
    }
  };

  // monta uma vez; o painel é remontado quando a fonte muda
  useEffect(() => {
    const s = live.current;
    const release = (): void => {
      if (s.disposed) return;
      s.disposed = true;
      releaseTorrent();
      cleanups.delete(release);
      optsRef.current.onRelease?.();
    };
    if (wrap.current) cleanups.set(release, wrap.current);
    // O servidor pode ter o P2P desligado (TORRENT_ENABLED=false): sem esta checagem o clique morreria num 501.
    health()
      .then((h) => {
        if (s.disposed) return;
        if (!h.torrentEnabled) return setView({ kind: 'disabled' });
        if (optsRef.current.autoStart) void start();
        else setView({ kind: 'idle', message: '' });
      })
      .catch(() => {
        if (s.disposed) return;
        if (optsRef.current.autoStart) void start();
        else setView({ kind: 'idle', message: '' });
      });
    // Desmontar (troca de fonte ou de tela) também fecha o torrent: o player não sobrevive ao painel.
    return () => {
      if (s.disposed) return;
      s.disposed = true;
      releaseTorrent();
      cleanups.delete(release);
    };
  }, []);

  const playingHash = view.kind === 'playing' ? view.result.infoHash : null;
  useEffect(() => {
    if (!playingHash) return;
    const poll = () => {
      getTorrentStatus(playingHash)
        .then((st) => !live.current.disposed && setStatus(st))
        .catch(() => !live.current.disposed && setLost(true));
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => clearInterval(timer);
  }, [playingHash]);

  const playerRef = opts.player ?? {
    channelId: 'archive',
    messageId: opts.identifier,
    route: titlePath('archive', '_', opts.identifier),
  };

  return (
    <div className="torrent-panel" ref={wrap}>
      {view.kind === 'checking' && <Skeleton rows={1} label="verificando o P2P" />}
      {view.kind === 'disabled' && (
        <p className="hint">
          P2P desligado neste servidor (<code>TORRENT_ENABLED=false</code>).
        </p>
      )}
      {view.kind === 'loading' && <p className="hint">{view.message}</p>}
      {view.kind === 'idle' && (
        <>
          {view.message && <p className="hint">{view.message}</p>}
          <Button
            className="torrent-start"
            variant="primary"
            size="sm"
            iconStart={<Icon name="download" size="sm" />}
            onClick={() => void start()}
          >
            assistir via torrent (P2P)
          </Button>
          <p className="hint">{opts.hint ?? ARCHIVE_HINT}</p>
        </>
      )}
      {view.kind === 'playing' && (
        <>
          {view.result.videoFiles.length >= 2 && (
            <Select
              label="Arquivo do torrent"
              value={String(view.result.selected.index)}
              // Não fecha o torrent: o servidor reaproveita o handle e só troca `fileIndex` (pedaços já baixados valem).
              onChange={(v) => void start(Number(v))}
              options={view.result.videoFiles.map((f) => ({
                value: String(f.index),
                label: `${f.label} — ${formatBytes(f.length)}`,
              }))}
            />
          )}
          {/* O mesmo player dos canais, sem "Minimizar": o torrent é fechado ao sair da tela, então o vídeo não sobrevive a ela. */}
          <InlinePlayer
            item={{
              key: `torrent:${view.result.infoHash}:${view.result.selected.index}`,
              src: view.result.streamUrl,
              title: opts.title,
              subtitle: opts.sourceLabel ?? 'Internet Archive · P2P',
              poster: opts.posterUrl ?? null,
              channelId: playerRef.channelId,
              messageId: playerRef.messageId,
              durationSeconds: null,
              route: playerRef.route,
              ...(opts.captions ? { captions: opts.captions } : {}),
            }}
            minimizable={false}
          />
          <TorrentStats status={status} lost={lost} />
          <Button
            className="torrent-stop"
            variant="ghost"
            size="sm"
            iconStart={<Icon name="stop" size="sm" />}
            onClick={() => {
              releaseTorrent();
              setView({ kind: 'idle', message: '' });
            }}
          >
            parar e liberar o torrent
          </Button>
        </>
      )}
    </div>
  );
}
