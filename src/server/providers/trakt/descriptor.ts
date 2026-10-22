import { registerDescriptor } from '../sources/registry.ts';
import { traktOAuth } from './oauth.ts';

const noSpaces = (value: string): string | null => (/\s/.test(value) ? 'não pode ter espaços' : null);

/** Trakt não é fonte de vídeo: só o cartão de Conexões (descritor + OAuth), sem `FileSource`. */
export const registerTrakt = (): void => {
  registerDescriptor({
    id: 'trakt',
    title: 'Trakt',
    description: 'Importa o que você já assistiu no Trakt para a sua lista (e envia o que você marcou aqui, por ação sua).',
    icon: 'check',
    fields: [
      { key: 'clientId', label: 'Client ID', env: 'TRAKT_CLIENT_ID', placeholder: 'client ID do app', required: true, validate: noSpaces },
      { key: 'clientSecret', label: 'Client secret', env: 'TRAKT_CLIENT_SECRET', secret: true, placeholder: 'client secret do app', required: true, validate: noSpaces },
    ],
    guide: {
      summary: 'Como criar o app no Trakt (uma vez)',
      steps: [
        'Entre em <a href="https://trakt.tv/oauth/applications" target="_blank" rel="noopener noreferrer">trakt.tv/oauth/applications</a> (ou o painel de desenvolvedor em developer.trakt.tv) e crie um app novo.',
        'Nome: <strong>nerd-watch</strong>. Em <em>Redirect URI</em> coloque exatamente <code>{{redirectUri}}</code>.',
        'Copie o <strong>Client ID</strong> e o <strong>Client secret</strong> do app para os campos acima e salve.',
        'Clique em <strong>Conectar Trakt</strong> e autorize na aba que abrir.',
      ],
    },
    oauth: traktOAuth,
    configured: () => traktOAuth.configured(),
    connected: () => traktOAuth.connected(),
  });
};
