import { registerDescriptor, registerSource } from '../sources/registry.ts';
import { type FileSource, SourceError } from '../sources/types.ts';
import { downloadThumb, fetchChannelName, listVideos } from './api.ts';
import { dailymotionEmbedUrl, dailymotionLink, handleOfDailymotion, parseDailymotionHandle, parseDailymotionInput } from './ids.ts';

const refOrThrow = (handle: string) => {
  const ref = parseDailymotionHandle(handle);
  if (!ref) throw new SourceError('canal do Dailymotion inválido', 400);
  return ref;
};

/** Só embed: o Dailymotion não oferece arquivo direto, então o app não faz proxy do vídeo. */
export const dailymotionSource: FileSource = {
  mode: 'dailymotion',

  link(handle) {
    const ref = parseDailymotionHandle(handle);
    return ref ? dailymotionLink(ref) : null;
  },

  async resolve(input) {
    const ref = parseDailymotionInput(input);
    if (!ref) throw new SourceError('informe o link do canal ou da playlist, ou o nome do canal no Dailymotion', 400);
    return { handle: handleOfDailymotion(ref), name: await fetchChannelName(ref) };
  },

  list: async (handle) => listVideos(refOrThrow(handle)),

  play() {
    return Promise.reject(new SourceError('o Dailymotion só toca por embed', 501));
  },

  embedUrl: (fileRef) => dailymotionEmbedUrl(fileRef),

  thumb: (item) => (item.thumbnailUrl ? downloadThumb(item.thumbnailUrl) : Promise.resolve(null)),
};

export const registerDailymotion = (): void => {
  registerSource(dailymotionSource);
  registerDescriptor({
    id: 'dailymotion',
    title: 'Dailymotion',
    description: 'Canais e playlists públicos do Dailymotion, tocados pelo embed. Sem conta, sem chave.',
    icon: 'play',
    fields: [],
    add: {
      mode: 'dailymotion',
      label: 'canal ou playlist do Dailymotion (link ou nome)',
      placeholder: 'dailymotion.com/canal ou dailymotion.com/playlist/x…',
      hint: 'Até 300 vídeos mais recentes. Toca pelo embed do Dailymotion.',
    },
    configured: () => true,
    connected: () => true,
  });
};
