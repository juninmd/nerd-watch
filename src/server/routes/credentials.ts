import { Hono } from 'hono';
import { CREDENTIAL_FIELDS, findField, GROUP_LABEL, maskSecret, type CredentialField } from '../credentials/registry.ts';
import { readCredential, saveCredential } from '../credentials/runtime.ts';
import { testCredential } from '../credentials/tester.ts';
import { guardInput, readJsonObject } from '../http/json-body.ts';

export const credentialsRoutes = new Hono();

/** Só estado: segredo vira "configurado" + pista curta; campo público devolve o valor. Nunca o segredo inteiro. */
const dto = (f: CredentialField) => {
  const value = readCredential(f.key);
  return {
    key: f.key,
    label: f.label,
    group: f.group,
    secret: f.secret,
    help: f.help,
    placeholder: f.placeholder,
    restart: f.restart === true,
    testable: f.testable,
    configured: value !== undefined,
    value: f.secret || value === undefined ? null : value,
    hint: f.secret && value !== undefined ? maskSecret(value) : null,
  };
};

credentialsRoutes.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

credentialsRoutes.get('/', (c) => c.json({ groups: GROUP_LABEL, fields: CREDENTIAL_FIELDS.map(dto) }));

credentialsRoutes.put('/:key', (c) =>
  guardInput(c, async () => {
    const field = findField(c.req.param('key'));
    if (!field) return c.json({ error: 'credencial desconhecida' }, 404);
    const body = await readJsonObject(c);
    if (typeof body.value !== 'string') return c.json({ error: 'corpo inválido' }, 400);
    const value = body.value.trim();
    if (!value) return c.json({ error: 'valor vazio (use remover para limpar)' }, 400);
    // A mensagem de validação é fixa por campo: nunca ecoa o valor recebido.
    const problem = field.validate(value);
    if (problem) return c.json({ error: problem }, 400);
    try {
      await saveCredential(field.key, value);
    } catch {
      return c.json({ error: 'não foi possível gravar o .env' }, 500);
    }
    return c.json(dto(field));
  }),
);

credentialsRoutes.delete('/:key', async (c) => {
  const field = findField(c.req.param('key'));
  if (!field) return c.json({ error: 'credencial desconhecida' }, 404);
  try {
    await saveCredential(field.key, undefined);
  } catch {
    return c.json({ error: 'não foi possível gravar o .env' }, 500);
  }
  return c.json(dto(field));
});

/** Testa o valor já salvo; o corpo é ignorado de propósito, para a chamada não aceitar um alvo vindo do navegador. */
credentialsRoutes.post('/:key/test', async (c) => {
  const field = findField(c.req.param('key'));
  if (!field) return c.json({ error: 'credencial desconhecida' }, 404);
  if (!field.testable) return c.json({ ok: false, message: 'sem teste disponível para esta credencial' });
  const value = readCredential(field.key);
  if (value === undefined) return c.json({ ok: false, message: 'credencial não configurada' });
  return c.json(await testCredential(field.key, value));
});
