import type { TitleStreamsDto } from '../api/stremio.ts';

export type AddonStreamGroup = TitleStreamsDto['addons'][number];
export type AddonStreamItem = AddonStreamGroup['streams'][number];

/** Resolve o botão clicado (`addonId` + `index` da lista) sem confiar na posição do DOM. */
export const findAddonStream = (
  dto: TitleStreamsDto,
  addonId: string | undefined,
  index: number,
): { group: AddonStreamGroup; stream: AddonStreamItem } | null => {
  if (!addonId || !Number.isInteger(index)) return null;
  const group = dto.addons.find((candidate) => candidate.addonId === addonId);
  const stream = group?.streams.find((candidate) => candidate.index === index);
  return group && stream ? { group, stream } : null;
};
