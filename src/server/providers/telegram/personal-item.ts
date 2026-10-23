import { Api } from 'teleproto';

export interface TelegramPersonalItem {
  messageId: string;
  caption: string | null;
  durationSeconds: number | null;
  postedAt: string | null;
  /** Atributos do próprio vídeo no MTProto: sem baixar nada. Nulos quando a mensagem não traz o atributo. Opcionais: contrato expandido. */
  width?: number | null;
  height?: number | null;
  supportsStreaming?: boolean | null;
  fileName?: string | null;
}

/** Mensagem vira item de vídeo; devolve null para o que não é vídeo (foto, texto, áudio). */
export const toItem = (msg: Api.Message): TelegramPersonalItem | null => {
  if (!(msg.media instanceof Api.MessageMediaDocument) || !(msg.media.document instanceof Api.Document)) return null;
  const doc = msg.media.document;
  const isVideo = doc.mimeType?.startsWith('video/') || doc.attributes.some((a) => a instanceof Api.DocumentAttributeVideo);
  if (!isVideo) return null;
  const videoAttr = doc.attributes.find((a): a is Api.DocumentAttributeVideo => a instanceof Api.DocumentAttributeVideo);
  const nameAttr = doc.attributes.find((a): a is Api.DocumentAttributeFilename => a instanceof Api.DocumentAttributeFilename);
  return {
    messageId: String(msg.id),
    caption: msg.message || null,
    durationSeconds: videoAttr ? Math.round(videoAttr.duration) : null,
    postedAt: new Date(msg.date * 1000).toISOString(),
    width: videoAttr?.w ?? null,
    height: videoAttr?.h ?? null,
    supportsStreaming: videoAttr ? videoAttr.supportsStreaming === true : null,
    fileName: nameAttr?.fileName || null,
  };
};
