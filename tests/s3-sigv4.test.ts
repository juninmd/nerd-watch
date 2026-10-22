import { describe, expect, test } from 'bun:test';
import { EMPTY_SHA256, amzDateOf, queryString, signV4, uriEncode } from '../src/server/providers/s3/sigv4.ts';

/** Credenciais de exemplo da própria documentação da AWS (não são segredos reais). */
const AWS_EXAMPLE = {
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 's3',
};
const AMZ_DATE = '20130524T000000Z';

/**
 * Vetores públicos da AWS (exemplos de assinatura do S3 com as chaves de exemplo acima): GET Object com Range e
 * ListObjects com max-keys=2 e prefix=J. Os valores batem com o assinador de referência (botocore 1.40.0). O teste
 * que importa é este: uma assinatura "que parece certa" mas diverge de um vetor publicado falha em produção.
 */
describe('assinatura SigV4 contra os vetores publicados pela AWS', () => {
  test('GET Object com Range (test.txt, bytes=0-9)', () => {
    const headers = signV4(
      { method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', query: [], headers: { Range: 'bytes=0-9' }, payloadHash: EMPTY_SHA256 },
      AWS_EXAMPLE,
      AMZ_DATE,
    );
    expect(headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  test('ListObjects com max-keys=2 e prefix=J', () => {
    const headers = signV4(
      {
        method: 'GET',
        host: 'examplebucket.s3.amazonaws.com',
        path: '/',
        query: [
          ['max-keys', '2'],
          ['prefix', 'J'],
        ],
        headers: {},
        payloadHash: EMPTY_SHA256,
      },
      AWS_EXAMPLE,
      AMZ_DATE,
    );
    expect(headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7',
    );
  });
});

describe('assinatura: propriedades que o vetor não cobre', () => {
  const base = {
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    query: [] as Array<[string, string]>,
    headers: { Range: 'bytes=0-9' },
    payloadHash: EMPTY_SHA256,
  };

  test('o segredo muda a assinatura e nunca aparece nos cabeçalhos devolvidos', () => {
    const a = signV4(base, AWS_EXAMPLE, AMZ_DATE);
    const b = signV4(base, { ...AWS_EXAMPLE, secretKey: 'outro-segredo-de-teste' }, AMZ_DATE);
    expect(a.Authorization).not.toBe(b.Authorization);
    expect(JSON.stringify(a)).not.toContain(AWS_EXAMPLE.secretKey);
  });

  test('região e data entram no escopo: outra região gera outra assinatura', () => {
    const a = signV4(base, AWS_EXAMPLE, AMZ_DATE).Authorization;
    expect(signV4(base, { ...AWS_EXAMPLE, region: 'auto' }, AMZ_DATE).Authorization).not.toBe(a);
    expect(signV4(base, AWS_EXAMPLE, '20130525T000000Z').Authorization).not.toBe(a);
  });

  test('um Range diferente muda a assinatura (o cabeçalho é assinado de verdade)', () => {
    const a = signV4(base, AWS_EXAMPLE, AMZ_DATE).Authorization;
    expect(signV4({ ...base, headers: { Range: 'bytes=10-19' } }, AWS_EXAMPLE, AMZ_DATE).Authorization).not.toBe(a);
  });

  test('uriEncode segue a regra do SigV4: só não-reservados ficam crus', () => {
    expect(uriEncode("a b+c~!*()'")).toBe('a%20b%2Bc~%21%2A%28%29%27');
    expect(uriEncode('Ep 01-ç.mp4')).toBe('Ep%2001-%C3%A7.mp4');
  });

  test('a query canônica ordena por chave (não pela string "k=v") e codifica nome e valor', () => {
    expect(
      queryString([
        ['a-b', '1'],
        ['a', '2'],
      ]),
    ).toBe('a=2&a-b=1');
    expect(
      queryString([
        ['prefix', 'anime/Ep 01'],
        ['max-keys', '2'],
      ]),
    ).toBe('max-keys=2&prefix=anime%2FEp%2001');
  });

  test('a data vira yyyymmddThhmmssZ em UTC', () => {
    expect(amzDateOf(new Date('2013-05-24T00:00:00.000Z'))).toBe(AMZ_DATE);
  });
});
