import { createHash, createHmac } from 'node:crypto';

/** Hash SHA-256 do corpo vazio: as requisições de leitura do S3 não têm payload. */
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** UriEncode do SigV4: codifica tudo exceto `A-Z a-z 0-9 - _ . ~` (o `encodeURIComponent` deixa `!'()*` crus). */
export const uriEncode = (text: string): string => encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Query string canônica e a que é enviada: a mesma função, para que o que foi assinado seja exatamente o que sai. */
export const queryString = (query: ReadonlyArray<readonly [string, string]>): string =>
  [...query]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

export interface SigV4Request {
  method: string;
  /** Host como vai no cabeçalho (com porta, se não for a padrão). */
  host: string;
  /** Caminho já codificado (cada segmento com `uriEncode`), exatamente como será enviado. */
  path: string;
  /** Parâmetros decodificados; a função codifica. */
  query: ReadonlyArray<readonly [string, string]>;
  /** Cabeçalhos extras que serão enviados (ex.: `Range`). Nomes em qualquer caixa. */
  headers: Record<string, string>;
  payloadHash: string;
}

export interface SigV4Credentials {
  accessKey: string;
  secretKey: string;
  region: string;
  service: string;
}

const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data, 'utf8').digest();
const sha256Hex = (data: string): string => createHash('sha256').update(data, 'utf8').digest('hex');

export const signingKey = (secretKey: string, date: string, region: string, service: string): Buffer =>
  hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), service), 'aws4_request');

/** `yyyymmddThhmmssZ` do instante dado. */
export const amzDateOf = (now: Date): string => now.toISOString().replace(/[:-]|\.\d{3}/g, '');

/**
 * Cabeçalhos de assinatura (AWS SigV4, `Authorization` no cabeçalho). Assina `host`, `x-amz-date`,
 * `x-amz-content-sha256` e os extras da requisição. Os valores de segredo nunca saem daqui além da assinatura.
 */
export const signV4 = (req: SigV4Request, creds: SigV4Credentials, amzDate: string): Record<string, string> => {
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) headers[name.toLowerCase()] = value.trim().replace(/\s+/g, ' ');
  headers.host = req.host;
  headers['x-amz-content-sha256'] = req.payloadHash;
  headers['x-amz-date'] = amzDate;

  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    req.method,
    req.path,
    queryString(req.query),
    names.map((n) => `${n}:${headers[n]}\n`).join(''),
    signedHeaders,
    req.payloadHash,
  ].join('\n');
  const scope = `${date}/${creds.region}/${creds.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(signingKey(creds.secretKey, date, creds.region, creds.service), stringToSign).toString('hex');
  return {
    'x-amz-date': amzDate,
    'x-amz-content-sha256': req.payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
};
