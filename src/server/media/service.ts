import { normalizeStart, parseOrdinal } from './args.ts';
import { type Binaries, binaryStatus } from './binaries.ts';
import { cacheKey, cachePath, removeOrphanParts, touchCache } from './cache.ts';
import { startLive } from './live.ts';
import { isPlayableVideo } from './playable.ts';
import { type Plan, decidePlan } from './plan.ts';
import { createProber } from './probe.ts';
import type { ProbeInfo } from './probe-parse.ts';
import { type Slots, createSlots } from './process.ts';
import { type RemuxStatus, createRemuxer } from './remux.ts';
import type { MediaSettings } from './settings.ts';
import { extractWebVtt } from './subtitles.ts';

/** Erro com o status HTTP da rota. A mensagem é nossa: nunca caminho do disco nem saída do ffmpeg. */
export class MediaError extends Error {
  constructor(
    readonly status: 404 | 409 | 501,
    message: string,
  ) {
    super(message);
  }
}

/** Arquivo local já resolvido pela fonte (realpath dentro de uma raiz). `null` quando o item não é de pasta local. */
export interface LocatedFile {
  file: string;
  name: string;
  size: number;
  mtimeMs: number;
}
export type Locator = (channelId: string, messageId: string) => Promise<LocatedFile | null>;

export interface PlanView {
  path: 'n/a' | 'direct' | 'remux' | 'transcode' | 'unavailable';
  reason?: string;
  audio?: 'copy' | 'aac' | 'none';
  deinterlace?: boolean;
  durationSeconds: number | null;
  audioOrdinal: number | null;
  audioTracks: { ordinal: number; codec: string; language: string | null; channels: number }[];
  subtitleTracks: { ordinal: number; codec: string; language: string | null; text: boolean }[];
}

interface Planned {
  kind: 'plan';
  located: LocatedFile;
  probe: ProbeInfo;
  plan: Plan;
  bins: Binaries;
}
type Analysis = { kind: 'na' } | { kind: 'direct' } | { kind: 'unavailable'; reason: string } | Planned;

type RemuxPlanned = Planned & { plan: Extract<Plan, { path: 'remux' }> };
type TranscodePlanned = Planned & { plan: Extract<Plan, { path: 'transcode' }> };

const EMPTY_TRACKS = { audioTracks: [], subtitleTracks: [] };

export const createMediaService = (opts: { settings: MediaSettings; locate: Locator; slots?: Slots }) => {
  const { settings, locate } = opts;
  const slots = opts.slots ?? createSlots(settings.maxJobs);
  let remuxer: ReturnType<typeof createRemuxer> | null = null;
  let remuxerBin = '';
  let prober: ReturnType<typeof createProber> | null = null;
  let proberBin = '';

  // Um remuxer por ffmpeg: jobs e dedupe ficam no mesmo objeto enquanto o binário não muda.
  const remuxerFor = (bins: Binaries) => {
    if (!remuxer || remuxerBin !== bins.ffmpeg) {
      remuxer = createRemuxer({
        bins,
        slots,
        cacheDir: settings.cacheDir,
        cacheMaxBytes: settings.cacheMaxBytes,
        idleMs: settings.idleMs,
      });
      remuxerBin = bins.ffmpeg;
    }
    return remuxer;
  };

  const proberFor = (bins: Binaries) => {
    if (!prober || proberBin !== bins.ffprobe) {
      prober = createProber(bins.ffprobe);
      proberBin = bins.ffprobe;
    }
    return prober;
  };

  /** Resolve o item, confere se precisa de conversão, sonda e decide. Não inicia nenhum processo de conversão. */
  const analyze = async (channelId: string, messageId: string, audioParam: string | undefined): Promise<Analysis> => {
    const located = await locate(channelId, messageId);
    if (!located) return { kind: 'na' };
    if (isPlayableVideo(located.name)) return { kind: 'direct' };
    const status = binaryStatus(settings);
    if (!status.ok) return { kind: 'unavailable', reason: status.reason };
    const probe = await proberFor(status.bins).probe(
      located.file,
      `${located.file}|${located.size}|${located.mtimeMs}`,
    );
    if (!probe) throw new MediaError(409, 'não foi possível ler os dados desse arquivo');
    const plan = decidePlan(probe, { preferredLangs: settings.audioLangs, audioOrdinal: parseOrdinal(audioParam) });
    if (plan.path === 'unavailable') return { kind: 'unavailable', reason: plan.reason };
    return { kind: 'plan', located, probe, plan, bins: status.bins };
  };

  /** Rotas de conversão só valem para um plano concreto: os demais casos viram erro com motivo. */
  const planOrThrow = (a: Analysis): Planned => {
    if (a.kind === 'na') throw new MediaError(404, 'a conversão só existe para vídeos de pasta local');
    if (a.kind === 'direct') throw new MediaError(409, 'esse formato já toca direto');
    if (a.kind === 'unavailable') throw new MediaError(501, a.reason);
    return a;
  };

  const remuxOrThrow = (a: Analysis): RemuxPlanned => {
    const p = planOrThrow(a);
    if (p.plan.path !== 'remux') throw new MediaError(409, 'esse vídeo não precisa de preparo');
    return p as RemuxPlanned;
  };

  const transcodeOrThrow = (a: Analysis): TranscodePlanned => {
    const p = planOrThrow(a);
    if (p.plan.path !== 'transcode') throw new MediaError(409, 'esse vídeo não precisa de transcodificação');
    return p as TranscodePlanned;
  };

  const remuxKeyOf = (p: RemuxPlanned): string =>
    cacheKey([
      p.located.file,
      p.located.size,
      p.located.mtimeMs,
      'remux',
      p.plan.videoStreamIndex,
      p.plan.audioOrdinal ?? -1,
      p.plan.audio,
    ]);

  return {
    slots,

    async plan(channelId: string, messageId: string, audioParam?: string): Promise<PlanView> {
      const a = await analyze(channelId, messageId, audioParam);
      if (a.kind === 'na') return { path: 'n/a', durationSeconds: null, audioOrdinal: null, ...EMPTY_TRACKS };
      if (a.kind === 'direct') return { path: 'direct', durationSeconds: null, audioOrdinal: null, ...EMPTY_TRACKS };
      if (a.kind === 'unavailable')
        return { path: 'unavailable', reason: a.reason, durationSeconds: null, audioOrdinal: null, ...EMPTY_TRACKS };
      const { probe, plan } = a;
      const view = {
        durationSeconds: probe.durationSeconds,
        audioOrdinal: plan.path === 'unavailable' ? null : plan.audioOrdinal,
        audioTracks: probe.audio.map((t) => ({
          ordinal: t.ordinal,
          codec: t.codec,
          language: t.language,
          channels: t.channels,
        })),
        subtitleTracks: probe.subtitles.map((t) => ({
          ordinal: t.ordinal,
          codec: t.codec,
          language: t.language,
          text: t.text,
        })),
      };
      if (plan.path === 'unavailable') return { ...view, path: 'unavailable', reason: plan.reason };
      if (plan.path === 'remux') return { ...view, path: 'remux', audio: plan.audio };
      return { ...view, path: 'transcode', deinterlace: plan.deinterlace };
    },

    /** Começa a conversão (ou acompanha a que já roda). `busy` quando todos os slots estão ocupados. */
    async prepare(channelId: string, messageId: string, audioParam?: string): Promise<RemuxStatus | { busy: true }> {
      const p = remuxOrThrow(await analyze(channelId, messageId, audioParam));
      return remuxerFor(p.bins).start({
        key: remuxKeyOf(p),
        input: p.located.file,
        videoStreamIndex: p.plan.videoStreamIndex,
        audioOrdinal: p.plan.audioOrdinal,
        audio: p.plan.audio,
        durationSeconds: p.probe.durationSeconds,
      });
    },

    async status(channelId: string, messageId: string, audioParam?: string): Promise<RemuxStatus> {
      const p = remuxOrThrow(await analyze(channelId, messageId, audioParam));
      return remuxerFor(p.bins).status(remuxKeyOf(p));
    },

    /** Caminho do MP4 pronto no cache (a rota serve com Range). Ainda não pronto vira 409. */
    async readyFile(channelId: string, messageId: string, audioParam?: string): Promise<string> {
      const p = remuxOrThrow(await analyze(channelId, messageId, audioParam));
      const key = remuxKeyOf(p);
      if ((await remuxerFor(p.bins).status(key)).state !== 'ready') throw new MediaError(409, 'ainda não está pronto');
      const file = cachePath(settings.cacheDir, key);
      await touchCache(file);
      return file;
    },

    /** Stream de transcodificação a partir de `start` segundos. `busy` quando não há slot. */
    async live(
      channelId: string,
      messageId: string,
      audioParam: string | undefined,
      startParam: string | undefined,
    ): Promise<Response | { busy: true }> {
      const p = transcodeOrThrow(await analyze(channelId, messageId, audioParam));
      return startLive(
        { bins: p.bins, slots, idleMs: settings.idleMs },
        {
          input: p.located.file,
          startSeconds: normalizeStart(startParam, p.probe.durationSeconds),
          videoStreamIndex: p.plan.videoStreamIndex,
          audioOrdinal: p.plan.audioOrdinal,
          deinterlace: p.plan.deinterlace,
        },
      );
    },

    /** Legenda de texto em WebVTT. Bitmap (PGS/VobSub) não converte. */
    async subtitle(channelId: string, messageId: string, ordinal: number): Promise<Uint8Array | { busy: true }> {
      const a = await analyze(channelId, messageId, undefined);
      if (a.kind !== 'plan') throw new MediaError(404, 'legenda não encontrada');
      const track = a.probe.subtitles.find((s) => s.ordinal === ordinal);
      if (!track?.text) throw new MediaError(404, 'legenda não encontrada');
      const release = slots.acquire();
      if (!release) return { busy: true };
      try {
        const vtt = await extractWebVtt(a.bins.ffmpeg, a.located.file, ordinal);
        if (!vtt) throw new MediaError(409, 'não foi possível extrair essa legenda');
        return vtt;
      } finally {
        release();
      }
    },
  };
};

/** Boot: apaga restos de conversões interrompidas. Falha de disco não derruba o servidor. */
export const cleanupMediaCache = async (settings: MediaSettings): Promise<void> => {
  await removeOrphanParts(settings.cacheDir).catch(() => 0);
};
