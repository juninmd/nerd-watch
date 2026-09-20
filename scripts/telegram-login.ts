import { createInterface } from 'node:readline/promises';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';

/**
 * Login interativo único da conta pessoal do Telegram. Roda só no terminal (`bun run telegram:login`) —
 * nunca aceita telefone/código/senha por HTTP, pra não expor essa superfície no servidor local.
 */
const apiId = Number(process.env.TELEGRAM_API_ID?.trim());
const apiHash = process.env.TELEGRAM_API_HASH?.trim();

if (!apiId || !apiHash) {
  console.error('Defina TELEGRAM_API_ID e TELEGRAM_API_HASH no .env antes de rodar este script (veja .env.example).');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const session = new StringSession('');
const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });

await client.start({
  phoneNumber: () => rl.question('Telefone (com código do país, ex: +5511999999999): '),
  password: () => rl.question('Senha de verificação em duas etapas (deixe em branco se não usar): '),
  phoneCode: () => rl.question('Código recebido no Telegram: '),
  onError: (err) => console.error(err),
});

const me = await client.getMe();
console.log(`\nLogin ok como: ${me.firstName ?? me.username ?? '(conta)'}`);
console.log('\nCopie a linha abaixo pra TELEGRAM_SESSION no seu .env (trate como senha):\n');
console.log(client.session.save());

await client.disconnect();
rl.close();
process.exit(0);
