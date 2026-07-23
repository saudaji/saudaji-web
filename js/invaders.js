// Alien Invaders — módulo aislado: init(container) / destroy()
const HS_KEY = 'games.invaders.highscore';

let canvas, ctx, hud, raf = null, pausado = false;
let W, H, jugador, balas, bombas, aliens, alienDir, alienBajar, oleada, score, vidas, ultTiro;
let onKey, onKeyUp, onVis, onPointerDown, onPointerMove;
const teclas = {};

function nuevaOleada() {
  aliens = [];
  const filas = Math.min(3 + oleada, 6), cols = 8;
  for (let f = 0; f < filas; f++)
    for (let c = 0; c < cols; c++)
      aliens.push({ x: 30 + c * (W - 60) / cols, y: 30 + f * 26, w: 22, h: 14, vivo: true });
  alienDir = 1;
}

function reiniciar() {
  jugador = { x: W / 2, w: 30, h: 12 };
  balas = []; bombas = [];
  oleada = 1; score = 0; vidas = 3; ultTiro = 0;
  nuevaOleada();
}

function disparar() {
  const ahora = performance.now();
  if (ahora - ultTiro < 300) return;
  ultTiro = ahora;
  balas.push({ x: jugador.x, y: H - 30 });
}

function gameOver() {
  const hs = parseInt(localStorage.getItem(HS_KEY), 10) || 0;
  if (score > hs) localStorage.setItem(HS_KEY, score);
  reiniciar();
}

function paso() {
  // jugador
  if (teclas['arrowleft'] || teclas['a']) jugador.x -= 5;
  if (teclas['arrowright'] || teclas['d']) jugador.x += 5;
  jugador.x = Math.max(20, Math.min(W - 20, jugador.x));

  // balas
  balas.forEach(b => b.y -= 8);
  balas = balas.filter(b => b.y > 0);

  // aliens
  const velocidad = 0.4 + oleada * 0.15 + (1 - aliens.filter(a => a.vivo).length / aliens.length) * 0.8;
  let borde = false;
  aliens.forEach(a => {
    if (!a.vivo) return;
    a.x += alienDir * velocidad;
    if (a.x < 15 || a.x > W - 35) borde = true;
  });
  if (borde) {
    alienDir *= -1;
    aliens.forEach(a => a.y += 12);
  }

  // bombas enemigas
  if (Math.random() < 0.008 + oleada * 0.004) {
    const vivos = aliens.filter(a => a.vivo);
    if (vivos.length) {
      const a = vivos[Math.floor(Math.random() * vivos.length)];
      bombas.push({ x: a.x + a.w / 2, y: a.y + a.h });
    }
  }
  bombas.forEach(b => b.y += 3 + oleada * 0.4);
  bombas = bombas.filter(b => b.y < H);

  // colisiones bala-alien
  balas.forEach(b => {
    aliens.forEach(a => {
      if (a.vivo && b.x > a.x && b.x < a.x + a.w && b.y > a.y && b.y < a.y + a.h) {
        a.vivo = false; b.y = -99; score += 10;
      }
    });
  });

  // colisiones bomba-jugador / alien llega abajo
  const py = H - 22;
  bombas.forEach(b => {
    if (Math.abs(b.x - jugador.x) < jugador.w / 2 && b.y > py - 8) {
      b.y = H + 99;
      if (--vidas <= 0) gameOver();
    }
  });
  if (aliens.some(a => a.vivo && a.y + a.h > py - 10)) gameOver();

  if (aliens.every(a => !a.vivo)) { oleada++; nuevaOleada(); }
}

function dibujar() {
  const tinta = getComputedStyle(document.documentElement).getPropertyValue('--tinta') || '#f2efe6';
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = tinta;
  ctx.fillRect(jugador.x - jugador.w / 2, H - 22, jugador.w, jugador.h);
  ctx.fillRect(jugador.x - 2, H - 28, 4, 6);
  aliens.forEach(a => { if (a.vivo) ctx.fillRect(a.x, a.y, a.w, a.h); });
  ctx.fillStyle = '#ffd76a';
  balas.forEach(b => ctx.fillRect(b.x - 1.5, b.y - 6, 3, 6));
  ctx.fillStyle = '#d92b2b';
  bombas.forEach(b => ctx.fillRect(b.x - 2, b.y, 4, 8));
  hud.textContent = 'puntos: ' + score + ' · vidas: ' + vidas + ' · oleada: ' + oleada + (pausado ? ' · PAUSA' : '');
}

function loop() {
  if (!pausado) { paso(); dibujar(); }
  raf = requestAnimationFrame(loop);
}

function init(container) {
  W = Math.min(420, container.clientWidth || 420, window.innerWidth - 40);
  H = Math.round(W * 1.1);
  canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  ctx = canvas.getContext('2d');
  hud = document.createElement('p');
  hud.className = 'juego-hud';
  hud.textContent = 'flechas/A-D mueven · espacio dispara · en táctil: arrastra y toca';
  container.append(hud, canvas);

  onKey = (e) => {
    const k = e.key.toLowerCase();
    if (['arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    teclas[k] = true;
    if (k === ' ') disparar();
    if (k === 'p') pausado = !pausado;
  };
  onKeyUp = (e) => { teclas[e.key.toLowerCase()] = false; };
  onPointerMove = (e) => {
    const r = canvas.getBoundingClientRect();
    jugador.x = (e.clientX - r.left) * (W / r.width);
  };
  onPointerDown = (e) => { onPointerMove(e); disparar(); };
  onVis = () => { if (document.hidden) pausado = true; };

  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  document.addEventListener('visibilitychange', onVis);

  reiniciar();
  raf = requestAnimationFrame(loop);
}

function destroy() {
  cancelAnimationFrame(raf);
  raf = null;
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('keyup', onKeyUp);
  document.removeEventListener('visibilitychange', onVis);
  if (canvas) { canvas.remove(); canvas = null; }
  if (hud) { hud.remove(); hud = null; }
}

export default { init, destroy };
