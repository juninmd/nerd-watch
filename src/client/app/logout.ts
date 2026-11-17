/** Encerra a sessão (`POST /logout` derruba as sessões do token) e volta para a tela de login. */
export const logout = async (): Promise<void> => {
  try {
    await fetch('/logout', { method: 'POST', redirect: 'manual' });
  } finally {
    location.assign('/login');
  }
};
