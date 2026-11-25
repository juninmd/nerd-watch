import { Badge, type BadgeTone as SonidoTone, Button } from '@juninmd/sonido';
import type { AddonStreamDto } from '../api/stremio.ts';
import { Icon } from '../ui/icon.tsx';
import { type BadgeTone, parseStreamDetails } from './stream-details.ts';

const TONE: Record<BadgeTone, SonidoTone> = { accent: 'accent', neutral: 'neutral', warn: 'warning' };

export interface StreamCardProps {
  stream: AddonStreamDto;
  /** Clique em "Assistir"; o cartão não toca nada sozinho. */
  onPlay: () => void;
  /** Fonte tocando agora: destaca o cartão e marca o botão com `aria-current`. */
  playing?: boolean;
}

function StreamAction({ stream, onPlay, playing }: StreamCardProps) {
  // `error`: o addon devolveu um vídeo de aviso (token/cache). Não há o que tocar: mostra só o texto.
  if (stream.kind === 'error') {
    return (
      <Badge tone="warning">
        <Icon name="alert" size="sm" /> aviso do addon
      </Badge>
    );
  }
  if (stream.kind === 'external') {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="stream-action"
        href={stream.url ?? ''}
        target="_blank"
        rel="noopener noreferrer"
        iconStart={<Icon name="forward" size="sm" />}
      >
        Abrir fora
      </Button>
    );
  }
  const torrent = stream.kind === 'torrent';
  return (
    <Button
      className="stream-action"
      size="sm"
      iconStart={<Icon name={torrent ? 'download' : 'play'} size="sm" />}
      aria-current={playing ? 'true' : undefined}
      onClick={onPlay}
    >
      {torrent ? 'Assistir P2P' : 'Assistir'}
    </Button>
  );
}

/**
 * Cartão detalhado de um stream do Stremio: cabeçalho, selos de resolução/codec/áudio/tamanho/seeds,
 * descrição completa preservando quebras de linha e metadados técnicos (arquivo, trackers, servidor).
 */
export function StreamCard(props: StreamCardProps) {
  const { stream, playing } = props;
  const details = parseStreamDetails(stream);
  const cls = ['stream-card', stream.kind === 'torrent' && 'stream-torrent', stream.kind === 'error' && 'stream-notice', playing && 'is-playing'];
  return (
    <li className={cls.filter(Boolean).join(' ')}>
      <div className="stream-card-head">
        <strong className="stream-card-title">{details.heading}</strong>
        <StreamAction {...props} />
      </div>
      {details.badges.length > 0 && (
        <div className="stream-badges">
          {details.badges.map((b) => (
            <Badge key={b.label} tone={TONE[b.tone]}>
              {b.label}
            </Badge>
          ))}
        </div>
      )}
      {details.lines.length > 0 && (
        <div className="stream-desc">
          {details.lines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
      {details.meta.length > 0 && (
        <div className="stream-meta">
          {details.meta.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
      )}
    </li>
  );
}
