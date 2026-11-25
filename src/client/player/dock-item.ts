import type { CaptionContext } from './player-captions-model.ts';

/** Um vídeo na fila do player global. */
export interface DockItem {
  /** Identifica o vídeo para guardar a posição (`<canal>:<mensagem>`). */
  key: string;
  src: string;
  title: string;
  subtitle: string;
  poster: string | null;
  channelId: string;
  messageId: string;
  durationSeconds: number | null;
  /** Rota da tela onde esse vídeo toca em tamanho grande (para onde "expandir" volta). */
  route: string;
  /** Iframe de embed (YouTube, ou PeerTube sem arquivo direto): não passa pelo `<video>`. */
  embedUrl?: string | null;
  /** Onde buscar legenda para este vídeo (sem ele, o menu só aceita arquivo escolhido pelo usuário). */
  captions?: CaptionContext | null;
}
