/** Base de toda chamada `/api`: resposta OK vira JSON tipado; erro vira `Error` com a mensagem fixa do servidor. */
export const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const message =
      (typeof body?.error === 'string' && body.error.trim()) ||
      res.statusText.trim() ||
      `erro ${res.status}`;
    throw new Error(message);
  }
  return res.json() as Promise<T>;
};
