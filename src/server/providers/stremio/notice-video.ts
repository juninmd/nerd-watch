/**
 * Addons de torrent publicam "stream" que **não é conteúdo**: quando o token do debrid está inválido,
 * o cache do provedor está cheio ou o torrent está baixando, a resposta vira um vídeo de aviso
 * (`/videos/failed_access_v3.mp4`, `/videos/limits_exceeded_v2.mp4`, …) com `name` do tipo
 * `Torrentio\nRD error`. Mostrar isso como botão "Assistir" faz o usuário abrir um cartaz de erro
 * achando que é o filme.
 *
 * A detecção é conservadora de propósito: só marca quando o **caminho** da URL é um vídeo de aviso
 * daquele tipo. Um filme chamado "Error" continua sendo filme.
 */
const NOTICE_PATH = /\/(?:videos|static|assets)\/[a-z0-9._-]*(?:failed|error|downloading|unavailable|limits_exceeded|blocked|too_big|rar|opening|infringement)[a-z0-9._-]*\.(?:mp4|webm|mp3|m4a)$/i;

export const isNoticeVideo = (url: string): boolean => {
  try {
    return NOTICE_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
};
