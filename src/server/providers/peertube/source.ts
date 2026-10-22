import { registerDescriptor, registerSource } from '../sources/registry.ts';
import { relayMedia } from '../sources/service.ts';
import { type FileSource, SourceError } from '../sources/types.ts';
import { fetchHeaders } from '../public-http.ts';
import { currentFetch, downloadThumb, embedUrlOf, fetchChannelName, isVideoUuid, listChannelVideos, videoChoice } from './api.ts';
import { handleOf, type ChannelRef, parseChannelInput, parseHandle } from './host.ts';

const MEDIA_TIMEOUT_MS = 15_000;

const refOrThrow = (handle: string): ChannelRef => {
  const ref = parseHandle(handle);
  if (!ref) throw new SourceError('canal do PeerTube inválido', 400);
  return ref;
};

export const peertubeSource: FileSource = {
  mode: 'peertube',

  link(handle) {
    const ref = parseHandle(handle);
    return ref ? `https://${ref.host}/video-channels/${ref.name}` : null;
  },

  async resolve(input) {
    const ref = parseChannelInput(input);
    if (!ref) throw new SourceError('informe canal@instancia.tld ou o link https://instancia.tld/c/canal (só instâncias públicas por HTTPS)', 400);
    return { handle: handleOf(ref), name: await fetchChannelName(ref) };
  },

  list: async (handle) => listChannelVideos(refOrThrow(handle)),

  async play({ handle, fileRef, range }) {
    const ref = refOrThrow(handle);
    if (!isVideoUuid(fileRef)) throw new SourceError('vídeo não encontrado nesse canal', 404);
    const choice = await videoChoice(ref.host, fileRef);
    // Só HLS na instância: o player do app não toca, então o navegador recebe o embed e o usa no lugar.
    if (choice.kind === 'embed') {
      return Response.json({ error: 'este vídeo só toca pelo site da instância', embedUrl: embedUrlOf(ref.host, fileRef) }, { status: 409 });
    }
    const upstream = await fetchHeaders(currentFetch(), choice.url, { headers: range ? { Range: range } : {} }, MEDIA_TIMEOUT_MS).catch(() => {
      throw new SourceError('não foi possível falar com a instância do PeerTube agora', 502);
    });
    return relayMedia(upstream, 'vídeo não encontrado nessa instância do PeerTube');
  },

  thumb: async (item) => {
    const ref = parseHandle(item.handle);
    return ref && item.thumbnailUrl ? downloadThumb(ref.host, item.thumbnailUrl) : null;
  },
};

export const registerPeertube = (): void => {
  registerSource(peertubeSource);
  registerDescriptor({
    id: 'peertube',
    title: 'PeerTube',
    description: 'Canais de instâncias PeerTube públicas viram canais. Não precisa de conta.',
    icon: 'film',
    fields: [],
    add: {
      mode: 'peertube',
      label: 'canal do PeerTube (canal@instância ou link)',
      placeholder: 'canal@instancia.tld ou https://instancia.tld/c/canal',
      hint: 'Só instâncias públicas por HTTPS. Vídeos sem arquivo direto tocam pelo site da instância.',
    },
    configured: () => true,
    connected: () => true,
  });
};
