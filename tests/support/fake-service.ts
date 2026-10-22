/** Fetch falso para os providers de nuvem: registra cada chamada e responde pelo `handler`. Nada de rede. */
export interface Call {
  method: string;
  url: string;
  headers: Headers;
  body: string;
}

export const fakeService = (handler: (call: Call) => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(input),
      headers: new Headers(init?.headers),
      body: String(init?.body ?? ''),
    };
    calls.push(call);
    return handler(call);
  };
  return { fn, calls };
};

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
