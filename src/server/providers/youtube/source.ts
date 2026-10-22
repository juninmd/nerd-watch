import { registerDescriptor, registerSource } from '../sources/registry.ts';
import { syntheticMessageId } from '../sources/service.ts';
import { type FileSource, SourceError } from '../sources/types.ts';
import { downloadThumb, fetchFeed, resolveHandle } from './api.ts';
import { handleOfYoutube, parseYoutubeHandle, parseYoutubeInput, VIDEO_ID, youtubeEmbedUrl, youtubeLink } from './ids.ts';

const refOrThrow = (handle: string) => {
  const ref = parseYoutubeHandle(handle);
  if (!ref) throw new SourceError('canal do YouTube inválido', 400);
  return ref;
};

/** Só embed: o app não baixa, não repassa e não faz proxy de vídeo do YouTube (os termos proíbem). */
export const youtubeSource: FileSource = {
  mode: 'youtube',

  link(handle) {
    const ref = parseYoutubeHandle(handle);
    return ref ? youtubeLink(ref.kind, ref.id) : null;
  },

  async resolve(input) {
    const ref = parseYoutubeInput(input);
    if (!ref) throw new SourceError('informe o link do canal ou da playlist, um @handle ou o ID (UC… ou PL…)', 400);
    const id = ref.kind === 'handle' ? await resolveHandle(ref.handle) : ref.id;
    const kind = ref.kind === 'playlist' ? 'playlist' : 'channel';
    const feed = await fetchFeed(kind, id);
    return { handle: handleOfYoutube(kind, id), name: feed.title ?? (kind === 'channel' ? 'Canal do YouTube' : 'Playlist do YouTube') };
  },

  async list(handle) {
    const ref = refOrThrow(handle);
    const feed = await fetchFeed(ref.kind, ref.id);
    return feed.videos.map((v) => ({
      messageId: syntheticMessageId(v.publishedAt, v.videoId),
      caption: v.title,
      durationSeconds: null,
      thumbnailUrl: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
      postedAt: v.publishedAt,
      fileRef: v.videoId,
    }));
  },

  play() {
    return Promise.reject(new SourceError('o YouTube só toca por embed (o app não baixa nem repassa esse vídeo)', 501));
  },

  embedUrl: (fileRef) => youtubeEmbedUrl(fileRef),

  thumb: (item) => (item.fileRef && VIDEO_ID.test(item.fileRef) ? downloadThumb(item.fileRef) : Promise.resolve(null)),
};

export const registerYoutube = (): void => {
  registerSource(youtubeSource);
  registerDescriptor({
    id: 'youtube',
    title: 'YouTube',
    description: 'Canais e playlists públicos do YouTube, tocados pelo embed. Sem conta, sem chave.',
    icon: 'play',
    fields: [],
    add: {
      mode: 'youtube',
      label: 'canal ou playlist do YouTube (link, @handle ou ID)',
      placeholder: 'youtube.com/@canal, youtube.com/channel/UC… ou playlist PL…',
      hint: 'O feed público do YouTube traz só os ~15 vídeos mais recentes. Toca pelo embed do YouTube.',
    },
    configured: () => true,
    connected: () => true,
  });
};
