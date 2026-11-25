import { Alert } from '@juninmd/sonido';
import { openAddonStream } from '../api/stremio.ts';
import { InlinePlayer } from '../player/inline-player.tsx';
import type { CaptionContext } from '../player/player-captions-model.ts';
import { stopIfOnPage } from '../player/player-dock.ts';
import { TorrentPanel } from '../player/torrent-player.tsx';
import { EmbedFrame } from '../player/watch-embed.tsx';
import { addonCaptionTracks, withAddonTracks } from './addon-captions.ts';
import type { AddonStreamGroup as Group, AddonStreamItem as Stream } from './stream-lookup.ts';

/** O que ocupa o slot do player; `id` muda a cada fonte para remontar o player em vez de reaproveitar. */
export type PlayState =
  | { id: number; kind: 'embed'; url: string }
  | { id: number; kind: 'inline' | 'torrent'; group: Group; stream: Stream }
  | { id: number; kind: 'unsupported' };

export interface StreamView {
  title: string;
  posterUrl: string | null;
  route: string;
  captions: CaptionContext | null;
}

interface StreamPlayerProps {
  state: PlayState;
  view: StreamView;
  /** O navegador não tocou o arquivo: o slot troca pelo aviso. */
  onUnsupported: () => void;
  /** O torrent foi liberado de fora (troca de fonte, rota): o slot esvazia. */
  onRelease: (id: number) => void;
}

/** Legendas que o addon publica para este stream entram no menu do player, antes das da busca. */
const captionsOf = (view: StreamView, g: Group, s: Stream): CaptionContext | null =>
  withAddonTracks(
    view.captions,
    addonCaptionTracks({
      addonId: g.addonId,
      type: g.type,
      contentId: g.contentId,
      streamIndex: s.index,
      subtitles: s.subtitles,
    }),
  );

export function StreamPlayer({ state, view, onUnsupported, onRelease }: StreamPlayerProps) {
  if (state.kind === 'unsupported') return <Alert tone="warning">O navegador não tocou este stream; tente outro da lista.</Alert>;
  if (state.kind === 'embed') {
    return (
      <div className="player-frame">
        <EmbedFrame url={state.url} title={view.title} />
      </div>
    );
  }
  const { group: g, stream: s } = state;
  if (state.kind === 'torrent') {
    return (
      <TorrentPanel
        identifier={g.contentId}
        title={s.filename ?? view.title}
        posterUrl={view.posterUrl}
        open={(fileIndex?: number) => openAddonStream(g.addonId, g.type, g.contentId, s.index, fileIndex)}
        sourceLabel={`Addon · ${g.name}`}
        hint="O servidor conecta direto nos peers deste torrent e serve os pedaços ao player; nada fica semeando ao sair da tela."
        player={{ channelId: 'addon', messageId: g.contentId, route: view.route }}
        autoStart
        captions={captionsOf(view, g, s)}
        // Trocar de fonte em outro episódio libera este painel; sem isso sobraria um "parar" apontando para torrent fechado.
        onRelease={() => onRelease(state.id)}
      />
    );
  }
  const captions = captionsOf(view, g, s);
  return (
    <InlinePlayer
      item={{
        key: `stremio:${g.addonId}:${g.contentId}:${s.index}`,
        src: s.url ?? '',
        title: view.title,
        subtitle: `Addon · ${g.name}`,
        poster: view.posterUrl,
        channelId: 'stremio',
        messageId: g.contentId,
        durationSeconds: null,
        route: view.route,
        ...(captions ? { captions } : {}),
      }}
      minimizable
      onUnsupported={() => {
        stopIfOnPage();
        onUnsupported();
      }}
    />
  );
}
