import { Badge, Button, Dialog, Kbd } from '@juninmd/sonido';
import { useEffect, useRef, useState } from 'react';
import type { StreamsQueryResolver } from '../addons/episode-streams.ts';
import { hdStill } from '../player/episode-play-model.ts';
import { stopIfOnPageIn } from '../player/player-dock.ts';
import { releaseTorrentPlayers } from '../player/torrent-player.tsx';
import { posterCssUrl } from '../ui/poster-css.ts';
import { Icon } from '../ui/icon.tsx';
import { openOverlay } from '../ui/overlay.tsx';
import { episodeCode, type EpisodeState, type EpisodeView } from './episode-browser-model.ts';
import { EpisodeStreams } from './episode-streams-section.tsx';
import { dateLabel } from './tvmaze-view.ts';

export interface EpisodeModalOptions {
  seriesTitle: string;
  /** Lista na ordem em que aparece na tela: ← e → andam por ela. */
  episodes: EpisodeView[];
  index: number;
  stateOf: (ep: EpisodeView) => EpisodeState;
  streams: (ep: EpisodeView) => ReturnType<StreamsQueryResolver>;
  /** Marca "visto até aqui". Ausente = série fora da sua lista. */
  onMark?: (ep: EpisodeView) => Promise<void>;
  /** Caminho do player dedicado; com ele, "assistir" num arquivo/torrent abre a tela própria em vez de tocar no modal. */
  playPath?: (ep: EpisodeView) => string;
}

function EpisodeMeta({ ep }: { ep: EpisodeView }) {
  const parts = [
    ep.rating ? `★ ${ep.rating.toFixed(1)}` : null,
    ep.runtime ? `${ep.runtime} min` : null,
    ep.airDate ? dateLabel(ep.airDate) : 'data a confirmar',
  ].filter((p): p is string => Boolean(p));
  return <div className="ep-meta">{parts.join(' · ')}</div>;
}

function EpisodeDialog({ opts, onClose }: { opts: EpisodeModalOptions; onClose: () => void }) {
  const [index, setIndex] = useState(opts.index);
  const [marking, setMarking] = useState(false);
  const [, setVersion] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const ep = opts.episodes[index] as EpisodeView;
  const state = opts.stateOf(ep);
  const first = index === 0;
  const last = index === opts.episodes.length - 1;

  // Trocar de episódio ou fechar encerra o player/torrent que tocava no modal (o minimizado continua).
  useEffect(() => {
    const el = body.current;
    return () => {
      if (!el) return;
      stopIfOnPageIn(el);
      releaseTorrentPlayers(el);
    };
  }, [index]);

  const step = (delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= opts.episodes.length) return;
    setIndex(next);
    // Na ponta da lista o botão some do alcance (desabilitado): o foco vai para "Fechar" e as teclas seguem no modal.
    if (next === 0 || next === opts.episodes.length - 1)
      body.current?.closest('dialog')?.querySelector<HTMLElement>('.sn-dialog__close')?.focus();
  };

  const mark = () => {
    if (!opts.onMark || marking || state === 'current') return;
    setMarking(true);
    opts
      .onMark(ep)
      .then(() => setVersion((v) => v + 1))
      .catch(() => undefined)
      .finally(() => setMarking(false));
  };

  const keys = useRef({ step, mark });
  keys.current = { step, mark };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dialog = body.current?.closest('dialog');
      if (!dialog || !(e.target instanceof Node) || !dialog.contains(e.target)) return;
      const typing = e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
      // Com vídeo aberto no modal, as setas são do player (avançar/voltar), não da troca de episódio.
      if (typing || e.altKey || e.ctrlKey || e.metaKey || dialog.querySelector('video, iframe')) return;
      if (e.key === 'ArrowRight') keys.current.step(1);
      else if (e.key === 'ArrowLeft') keys.current.step(-1);
      else if (e.key.toLowerCase() === 'w') keys.current.mark();
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  // Capa em alta no modal (a miniatura da lista continua leve).
  const still = hdStill(ep.stillUrl);
  return (
    <Dialog open onClose={onClose} title={ep.name} className="ep-modal">
      <div ref={body}>
        <div className="ep-modal-head">
          {/* Via CSSOM + posterCssUrl: escapa aspas/barras e a URL nunca é parseada como marcação. */}
          <div className="ep-modal-still" style={still ? { backgroundImage: posterCssUrl(still) } : undefined} />
          <div className="ep-modal-tools">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Episódio anterior"
              disabled={first}
              onClick={() => step(-1)}
            >
              <Icon name="back" size="sm" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Próximo episódio" disabled={last} onClick={() => step(1)}>
              <Icon name="forward" size="sm" />
            </Button>
          </div>
          <div className="ep-modal-title">
            <span className="eyebrow">
              {opts.seriesTitle} · {episodeCode(ep)}
            </span>
            <EpisodeMeta ep={ep} />
          </div>
        </div>
        <div className="ep-modal-body">
          <p className="ep-modal-overview">{ep.overview || 'Sem sinopse disponível.'}</p>
          <div className="ep-modal-actions">
            {!opts.onMark ? (
              <span className="hint">Adicione a série à sua lista para marcar episódios.</span>
            ) : state === 'current' ? (
              <Badge tone="success">✓ é onde você parou</Badge>
            ) : (
              <Button
                variant={state === 'watched' ? 'ghost' : 'primary'}
                size="sm"
                loading={marking}
                iconStart={<Icon name="check" size="sm" />}
                onClick={mark}
              >
                {state === 'watched' ? 'Voltar o marcador para cá' : 'Marcar visto até aqui'}
              </Button>
            )}
            <span className="hint ep-keys">
              <Kbd>←</Kbd> <Kbd>→</Kbd> trocam de episódio
              {opts.onMark && (
                <>
                  , <Kbd>w</Kbd> marca como visto
                </>
              )}
            </span>
          </div>
          <section aria-labelledby="ep-where">
            <h3 id="ep-where">Onde assistir</h3>
            <EpisodeStreams
              key={`${ep.season}:${ep.number}`}
              seriesTitle={opts.seriesTitle}
              ep={ep}
              streams={opts.streams}
              playPath={opts.playPath}
              onClose={onClose}
            />
          </section>
        </div>
      </div>
    </Dialog>
  );
}

let closeOpen: (() => void) | null = null;

/** Detalhe do episódio em Dialog do Sonido: sinopse, marcar como visto e links dos addons com filtros. */
export const openEpisodeModal = (opts: EpisodeModalOptions): void => {
  closeOpen?.();
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const close = openOverlay((closeOverlay) => (
    <EpisodeDialog
      opts={opts}
      onClose={() => {
        closeOverlay();
        if (closeOpen === close) closeOpen = null;
        if (opener?.isConnected) opener.focus();
      }}
    />
  ));
  closeOpen = close;
};
