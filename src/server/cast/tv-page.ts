export interface TvWatchPageOptions {
  title: string;
  subtitle?: string;
  mediaUrl: string;
  subtitleUrl?: string | null;
  posterUrl?: string | null;
  startAt?: number;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);

/**
 * Página enxuta e autocontida para o navegador da Smart TV (ou celular na mesma rede).
 * Funciona com controle remoto (setas, Enter, Play/Pause, Rewind/FastForward) e sem depender da casca principal.
 */
export const renderTvWatchPage = (opts: TvWatchPageOptions): string => {
  const title = escapeHtml(opts.title || 'nerd-watch TV');
  const subtitle = opts.subtitle ? escapeHtml(opts.subtitle) : '';
  const mediaUrl = escapeHtml(opts.mediaUrl);
  const posterAttr = opts.posterUrl ? ` poster="${escapeHtml(opts.posterUrl)}"` : '';
  const track = opts.subtitleUrl
    ? `<track kind="subtitles" label="Legenda" srclang="pt" src="${escapeHtml(opts.subtitleUrl)}" default />`
    : '';
  const startAt = Number.isFinite(opts.startAt) && (opts.startAt ?? 0) > 0 ? Math.floor(opts.startAt ?? 0) : 0;

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — nerd-watch TV</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; background: #05060a; color: #f5f7ff; font-family: system-ui, -apple-system, sans-serif; overflow: hidden; }
    main { position: relative; width: 100%; height: 100%; display: grid; place-items: center; }
    video { width: 100%; height: 100%; object-fit: contain; background: #000; }
    .hud { position: fixed; inset: 0 0 auto 0; padding: 20px 28px; background: linear-gradient(to bottom, rgba(5,6,10,.82), transparent); transition: opacity .25s; pointer-events: none; }
    .hud h1 { margin: 0; font-size: clamp(18px, 2.4vw, 28px); font-weight: 700; }
    .hud p { margin: 4px 0 0; font-size: 14px; color: rgba(245,247,255,.72); }
    .hud.hidden { opacity: 0; }
    .tap { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(5,6,10,.55); }
    .tap[hidden] { display: none; }
    .tap button { font: inherit; font-size: 20px; font-weight: 700; padding: 16px 32px; border-radius: 999px; border: 0; background: #7c5cff; color: #fff; cursor: pointer; }
    .tap button:focus-visible { outline: 3px solid #fff; outline-offset: 4px; }
  </style>
</head>
<body>
  <main>
    <header class="hud" id="hud">
      <h1>${title}</h1>
      ${subtitle ? `<p>${subtitle}</p>` : ''}
    </header>
    <video id="v" controls autoplay playsinline preload="metadata" data-start="${startAt}"${posterAttr}>
      <source src="${mediaUrl}" />
      ${track}
    </video>
    <div class="tap" id="tap" hidden>
      <button type="button" id="tap-play">Assistir na TV</button>
    </div>
  </main>
  <script>
    (function () {
      var v = document.getElementById('v');
      var hud = document.getElementById('hud');
      var tap = document.getElementById('tap');
      var tapBtn = document.getElementById('tap-play');
      var startAt = Number(v.getAttribute('data-start') || '0');
      var hideTimer = null;
      function showHud() {
        hud.classList.remove('hidden');
        clearTimeout(hideTimer);
        if (!v.paused) hideTimer = setTimeout(function () { hud.classList.add('hidden'); }, 3500);
      }
      function tryPlay() {
        var p = v.play();
        if (p && typeof p.catch === 'function') {
          p.catch(function () { tap.hidden = false; tapBtn.focus(); });
        }
      }
      v.addEventListener('loadedmetadata', function () {
        if (startAt > 0 && isFinite(v.duration) && startAt < v.duration) v.currentTime = startAt;
      }, { once: true });
      v.addEventListener('play', function () { tap.hidden = true; showHud(); });
      v.addEventListener('pause', showHud);
      tapBtn.addEventListener('click', function () { tap.hidden = true; tryPlay(); });
      document.addEventListener('mousemove', showHud);
      document.addEventListener('keydown', function (e) {
        showHud();
        if (e.key === ' ' || e.key === 'Enter' || e.key === 'MediaPlayPause') {
          if (document.activeElement === tapBtn) return;
          e.preventDefault();
          if (v.paused) tryPlay(); else v.pause();
        } else if (e.key === 'ArrowRight' || e.key === 'MediaFastForward') {
          e.preventDefault();
          v.currentTime = Math.min(isFinite(v.duration) ? v.duration : v.currentTime + 10, v.currentTime + 10);
        } else if (e.key === 'ArrowLeft' || e.key === 'MediaRewind') {
          e.preventDefault();
          v.currentTime = Math.max(0, v.currentTime - 10);
        } else if (e.key === 'f' || e.key === 'F') {
          if (document.fullscreenElement) document.exitFullscreen();
          else if (v.requestFullscreen) v.requestFullscreen();
        }
      });
      tryPlay();
    })();
  </script>
</body>
</html>`;
};
