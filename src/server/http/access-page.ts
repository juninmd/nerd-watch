/**
 * Página de login renderizada no servidor, sem JS: o formulário POST manda o token uma vez e o servidor
 * responde com o cookie. Só recebe textos fixos, nunca o valor digitado.
 */
export const loginPage = (message?: string): string => `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>nerd-watch · entrar</title>
<style>
:root { color-scheme: light dark; --bg: #f6f6f4; --fg: #1d1d1b; --card: #ffffff; --line: #c9c9c4; --accent: #2a5bd7; --err: #b3261e; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #141416; --fg: #ececea; --card: #1f1f23; --line: #3a3a40; --accent: #7ea6ff; --err: #ff8a80; } }
:root[data-theme="dark"] { --bg: #141416; --fg: #ececea; --card: #1f1f23; --line: #3a3a40; --accent: #7ea6ff; --err: #ff8a80; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; box-sizing: border-box; background: var(--bg); color: var(--fg); font: 16px/1.4 system-ui, sans-serif; }
main { width: 100%; max-width: 360px; box-sizing: border-box; padding: 24px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; }
h1 { margin: 0 0 8px; font-size: 20px; }
p { margin: 0 0 16px; font-size: 14px; }
label { display: block; font-size: 14px; }
input { display: block; width: 100%; box-sizing: border-box; margin-top: 6px; padding: 10px; font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; }
button { width: 100%; margin-top: 16px; padding: 10px; font: inherit; font-weight: 600; color: #ffffff; background: var(--accent); border: 0; border-radius: 8px; cursor: pointer; }
input:focus-visible, button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.erro { color: var(--err); font-weight: 600; }
</style>
</head>
<body>
<main>
<h1>nerd-watch</h1>
<p>Este servidor pede o token de acesso configurado em <code>ACCESS_TOKEN</code>.</p>
<form method="post" action="/login">
<label>Token de acesso
<input name="token" type="password" autocomplete="current-password" required autofocus>
</label>
<button type="submit">Entrar</button>
</form>
${message ? `<p class="erro" role="alert">${message}</p>` : ''}
</main>
</body>
</html>
`;
