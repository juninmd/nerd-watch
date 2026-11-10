/**
 * Versão do app a partir de commits convencionais (ver docs/adr/0004-auto-update-tauri.md).
 *
 * A regra existe para o release automático não publicar versão sem motivo: `feat` sobe minor,
 * `fix`/`perf`/`refactor` sobem patch, `!` no cabeçalho ou `BREAKING CHANGE` no corpo sobe major.
 * Commit que não é convencional (`docs:`, `chore:`, `Merge ...`) não publica nada — um release por
 * push de README encheria a lista de releases e o auto-update baixaria à toa.
 */

export type Bump = 'major' | 'minor' | 'patch';

export interface CommitInfo {
  /** Primeira linha do commit. */
  subject: string;
  /** Corpo (opcional): é onde mora o rodapé `BREAKING CHANGE`. */
  body?: string;
}

/** Tipos convencionais que merecem release. Qualquer outro tipo é ignorado. */
const RELEASE_TYPES: Record<string, Bump> = { feat: 'minor', fix: 'patch', perf: 'patch', refactor: 'patch' };

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?:\s+\S/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** `v1.2.3` e `1.2.3` valem; qualquer outra coisa é versão inválida (não inventa número). */
export const parseVersion = (raw: string): [number, number, number] | null => {
  const match = VERSION.exec(raw.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

export const formatVersion = ([major, minor, patch]: [number, number, number]): string => `${major}.${minor}.${patch}`;

export const bumpVersion = (current: string, bump: Bump): string | null => {
  const parsed = parseVersion(current);
  if (!parsed) return null;
  const [major, minor, patch] = parsed;
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
};

/** Merge commit e o próprio commit de release nunca contam como mudança. */
const ignored = (subject: string): boolean => /^Merge\b/.test(subject) || /^chore\(release\)/.test(subject);

/** Bump de um commit, ou `null` quando ele não pede release. */
export const commitBump = (commit: CommitInfo): Bump | null => {
  const subject = commit.subject.trim();
  if (!subject || ignored(subject)) return null;
  const header = HEADER.exec(subject);
  if (!header?.groups) return null;
  const breaking = Boolean(header.groups.breaking) || BREAKING_FOOTER.test(commit.body ?? '');
  // Um `BREAKING CHANGE` obriga release mesmo vindo de um tipo fora da lista (ex.: `docs!:`),
  // senão a quebra de contrato ficaria sem versão nova para o auto-update entregar.
  if (breaking) return 'major';
  return RELEASE_TYPES[header.groups.type ?? ''] ?? null;
};

/**
 * Maior bump entre os commits desde a última tag. `null` = nada a publicar (o workflow para aqui,
 * e o auto-update simplesmente não vê versão nova).
 */
export const nextVersion = (current: string, commits: CommitInfo[]): { version: string; bump: Bump } | null => {
  const order: Bump[] = ['patch', 'minor', 'major'];
  let winner: Bump | null = null;
  for (const commit of commits) {
    const bump = commitBump(commit);
    if (bump && (!winner || order.indexOf(bump) > order.indexOf(winner))) winner = bump;
  }
  if (!winner) return null;
  const version = bumpVersion(current, winner);
  return version ? { version, bump: winner } : null;
};
