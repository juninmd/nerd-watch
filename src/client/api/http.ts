/** Base de toda chamada `/api`: resposta OK vira JSON tipado; erro vira `Error` com a mensagem fixa do servidor. */
export const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `erro ${res.status}`);
  }
  return res.json() as Promise<T>;
};
