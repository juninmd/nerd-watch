const MAX_PATH = 2048;

/** Caractere de controle (C0 ou DEL): nunca entra em caminho nem em cabeçalho. */
const hasControl = (text: string): boolean => [...text].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

/** Caminho dentro de um servidor remoto (`/pasta/ep.mp4`): absoluto, sem `..`/`.`, sem controle nem barra invertida. */
export const isSafeRemotePath = (path: string): boolean =>
  path.length <= MAX_PATH && path.startsWith('/') && !hasControl(path) && !path.includes('\\') && path.split('/').every((seg) => seg !== '..' && seg !== '.');

/** Mesmo que `isSafeRemotePath`, mas sem barra final e com as barras repetidas colapsadas (chave estável no banco). */
export const normalizeRemotePath = (path: string): string => `/${path.split('/').filter(Boolean).join('/')}`;

/** Caminho relativo à pasta do canal (`sub/ep.mp4`), usado como `fileRef` de fontes de arquivo. */
export const isSafeRelativePath = (path: string): boolean => path.length > 0 && path.length <= MAX_PATH && !path.startsWith('/') && isSafeRemotePath(`/${path}`);
