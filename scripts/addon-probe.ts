import { fetchManifestFrom, fetchStreams } from '../src/server/providers/stremio/protocol.ts';
import { parseAddonUrl } from '../src/server/providers/stremio/url.ts';

/**
 * Verificação de fumaça dos addons configurados no ambiente (`ADDON_MANIFEST_URLS`).
 *
 * Roda no CI com o link vindo de segredo do repositório: o domínio e o caminho do manifest nunca
 * aparecem no código nem na saída deste script. O que se imprime é o nome do addon, os recursos que
 * ele declara e quantos streams ele oferece para um item fixo. Sem a variável, sai com 0 e não faz rede.
 */
const urls = (process.env.ADDON_MANIFEST_URLS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const item = process.env.ADDON_PROBE_ITEM?.trim() || 'tt0111161';

if (urls.length === 0) {
  console.log('ADDON_MANIFEST_URLS vazio: nada a verificar');
  process.exit(0);
}

let failures = 0;
for (const raw of urls) {
  try {
    const { manifestUrl, baseUrl } = parseAddonUrl(raw);
    const manifest = await fetchManifestFrom(manifestUrl);
    const streams = manifest.resources.includes('stream') ? await fetchStreams(baseUrl, 'movie', item) : [];
    const torrents = streams.filter((s) => s.kind === 'torrent' && s.infoHash).length;
    console.log(`ok ${manifest.name} v${manifest.version}: [${manifest.resources.join(', ')}], ${streams.length} stream(s), ${torrents} torrent(s)`);
  } catch (err) {
    failures++;
    // Só o tipo do erro: a mensagem pode conter o endereço que estamos tratando como segredo.
    console.error(`falhou (${err instanceof Error ? err.name : 'erro'})`);
  }
}

process.exit(failures > 0 ? 1 : 0);
