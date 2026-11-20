/** Ação opcional no aviso (ex.: "Desfazer"); sem ela o aviso some sozinho mais cedo. */
export const showToast = (message: string, action?: { label: string; run: () => void }): void => {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      el.remove();
      action.run();
    });
    el.appendChild(btn);
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), action ? 7000 : 2600);
};
