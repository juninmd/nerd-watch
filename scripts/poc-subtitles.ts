export {};

/**
 * PoC da busca de legendas contra um servidor já rodando e o addon REAL.
 *
 *   bun run dev               # numa aba
 *   bun run poc:subtitles     # noutra
 *
 * Prova o caminho sem chave nenhuma: busca agregada, filtro/ordem de idioma, e o download
 * passando pelo proxy do próprio app (que nunca aceita URL vinda do cliente).
 */

const BASE = process.env.POC_BASE ?? 'http://127.0.0.1:7799';
const IMDB = process.argv[2] ?? 'tt0111161'; // Shawshank (1994)
const MEDIA = process.argv[3] ?? 'movie';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

interface SubtitleResult {
  source: string;
  id: string;
  languageCode: string;
  language: string;
  release: string;
  downloads: number | null;
  directUrl?: string;
  fileId?: number;
}

console.log(`\n1) busca agregada (${IMDB}, ${MEDIA}) — sem nenhuma chave configurada...`);
const t0 = Date.now();
const searchRes = await fetch(`${BASE}/api/subtitles?imdbId=${IMDB}&mediaType=${MEDIA}`);
const search = (await searchRes.json()) as {
  enabled: boolean;
  sources: string[];
  unavailable: string[];
  results: SubtitleResult[];
  error?: string;
};

check('GET /api/subtitles respondeu 200', searchRes.status === 200, `status ${searchRes.status} ${search.error ?? ''}`);
check('busca considerada habilitada', search.enabled === true);
check('pelo menos uma fonte respondeu', search.sources.length > 0, search.sources.join(', ') || '(nenhuma)');
check('veio pelo menos uma legenda', search.results.length > 0, `${search.results.length} resultados em ${Date.now() - t0}ms`);

const languages = [...new Set(search.results.map((r) => r.languageCode))];
console.log(`     idiomas retornados: ${languages.join(', ')}`);
console.log('     amostra:');
for (const r of search.results.slice(0, 5)) {
  console.log(`       - [${r.language}] ${r.source} | ${r.release || '(release não informado)'}`);
}

check('só vieram idiomas configurados (pt-BR, pt, en)', languages.every((l) => ['pt-BR', 'pt', 'en'].includes(l)), languages.join(', '));
check('idioma preferido vem primeiro', search.results[0]?.languageCode === 'pt-BR', search.results[0]?.languageCode ?? '(vazio)');
check('resultados de addon trazem URL direta', search.results.some((r) => Boolean(r.directUrl)));

console.log('\n2) download pelo proxy do app (o cliente não manda URL de destino)...');
const first = search.results[0];
if (!first) {
  console.log('  (sem resultados para baixar)');
} else {
  const dlRes = await fetch(`${BASE}/api/subtitles/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: first.source, id: first.id, imdbId: IMDB, mediaType: MEDIA }),
  });
  const dl = (await dlRes.json()) as { url?: string; error?: string };
  check('POST /download respondeu 200', dlRes.status === 200, dl.error ?? `status ${dlRes.status}`);
  check('devolveu uma URL do próprio app', Boolean(dl.url?.startsWith('/api/subtitles/file?')), dl.url ?? '(vazio)');
  check('a URL não expõe o host do arquivo (o cliente não recebe a URL de destino)', !String(dl.url).includes('subs5.strem.io'), String(dl.url));
  check('a fonte na URL é a base do addon configurado (validada por allowlist)', String(dl.url).includes(encodeURIComponent('https://opensubtitles-v3.strem.io')));

  if (dl.url) {
    const fileRes = await fetch(`${BASE}${dl.url}`);
    const text = await fileRes.text();
    const isSubtitle = /-->/.test(text) || /^\d+\s*$/m.test(text);
    check('o proxy serviu o arquivo', fileRes.status === 200, `status ${fileRes.status}`);
    check('o conteúdo parece uma legenda', isSubtitle, `${text.length} bytes`);
    check('vem como anexo com nome de arquivo', (fileRes.headers.get('content-disposition') ?? '').includes('.srt'), fileRes.headers.get('content-disposition') ?? '(vazio)');
  }
}

console.log('\n3) o proxy recusa fonte não configurada (não vira proxy aberto)...');
const evil = await fetch(`${BASE}/api/subtitles/file?source=https%3A%2F%2Fevil.com&id=1&imdbId=${IMDB}`);
check('403 para host fora de SUBTITLE_ADDONS', evil.status === 403, `status ${evil.status}`);

console.log(`\n${failures === 0 ? '✅ PoC de legendas passou' : `❌ PoC de legendas falhou (${failures} checagens)`}`);
process.exit(failures === 0 ? 0 : 1);
