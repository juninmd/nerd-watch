import type { FileSource, SourceDescriptor, SourceMode } from './types.ts';

const sources = new Map<string, FileSource>();
const descriptors = new Map<string, SourceDescriptor>();

/** Cada provider registra a si mesmo; descriptor e fonte de arquivo são independentes (OAuth de metadados, p. ex., só tem descriptor). */
export const registerDescriptor = (descriptor: SourceDescriptor): void => {
  descriptors.set(descriptor.id, descriptor);
};

export const registerSource = (source: FileSource): void => {
  sources.set(source.mode, source);
};

export const getSource = (mode: string): FileSource | undefined => sources.get(mode);
export const isSourceMode = (mode: unknown): mode is SourceMode => typeof mode === 'string' && sources.has(mode);
export const getDescriptor = (id: string): SourceDescriptor | undefined => descriptors.get(id);
export const listDescriptors = (): SourceDescriptor[] => [...descriptors.values()];

/** Só para testes: um teste registra fontes falsas e devolve o registro como estava. */
export const snapshotRegistry = () => ({ sources: new Map(sources), descriptors: new Map(descriptors) });

export const restoreRegistry = (snapshot: ReturnType<typeof snapshotRegistry>): void => {
  sources.clear();
  descriptors.clear();
  for (const [k, v] of snapshot.sources) sources.set(k, v);
  for (const [k, v] of snapshot.descriptors) descriptors.set(k, v);
};
