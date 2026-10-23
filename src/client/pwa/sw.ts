import { isShellRequest, isStaleShellCache, SHELL_CACHE_NAME } from './shell-cache.ts';

// O tsconfig não carrega a lib "webworker", então o escopo do service worker é tipado à mão, só com o que usamos.
interface ExtendableEventLike {
  waitUntil(task: Promise<unknown>): void;
}
interface FetchEventLike extends ExtendableEventLike {
  request: Request;
  respondWith(response: Promise<Response>): void;
}
interface WorkerScope {
  location: Location;
  clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEventLike) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void;
}

const scope = self as unknown as WorkerScope;

/**
 * Rede primeiro, cache como reserva: o bundle muda a cada deploy, então servir do cache por padrão
 * deixaria a página velha no ar. Offline, a última casca baixada com sucesso é o que sobra.
 */
const networkFirst = async (request: Request): Promise<Response> => {
  const cache = await caches.open(SHELL_CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok && response.status === 200) {
      cache.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
};

scope.addEventListener('install', () => {
  void scope.skipWaiting();
});

scope.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (isStaleShellCache(name)) await caches.delete(name);
      }
      await scope.clients.claim();
    })(),
  );
});

scope.addEventListener('fetch', (event) => {
  const request = event.request;
  const shell = isShellRequest(
    { method: request.method, url: request.url, hasRange: request.headers.has('range') },
    scope.location.origin,
  );
  // Fora da casca não chamamos respondWith: o browser segue direto para a rede, como sem service worker.
  if (!shell) return;
  event.respondWith(networkFirst(request));
});
