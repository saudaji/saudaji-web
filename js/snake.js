// Snake — módulo aislado: init(container) / destroy()
const HS_KEY = 'games.snake.highscore';

let canvas, ctx, timer = null, hud, container;
let snake, dir, nextDir, food, score, pausado;
const COLS = 20, ROWS = 20;
let cell;

let onKey, onVis, onTouchStart, onTouchEnd;
let touchX0 = 0, touchY0 = 0;

function colocarComida() {
  do {
    food = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
  } while (snake.some(s => s.x === food.x && s.y === food.y));
}

function velocidad() {
  // escala con longitud: 160ms base, -4ms por segmento, mínimo 60ms
  return Math.max(60, 160 - snake.length * 4);
}

function programar() {
  clearInterval(timer);
  timer = setInterval(tick, velocidad());
}

function reiniciar() {
  snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
  dir = { x: 1, y: 0 };
  nextDir = dir;
  score = 0;
  pausado = false;
  colocarComida();
  programar();
}

function morir() {
  const hs = parseInt(localStorage.getItem(HS_KEY), 10) || 0;
  if (score > hs) localStorage.setItem(HS_KEY, score);
  reiniciar();
}

function tick() {
  if (pausado) return;
  dir = nextDir;
  const cabeza = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
  if (cabeza.x < 0 || cabeza.x >= COLS || cabeza.y < 0 || cabeza.y >= ROWS ||
      snake.some(s => s.x === cabeza.x && s.y === cabeza.y)) return morir();
  snake.unshift(cabeza);
  if (cabeza.x === food.x && cabeza.y === food.y) {
    score++;
    colocarComida();
    programar();
  } else {
    snake.pop();
  }
  dibujar();
}

function dibujar() {
  const css = getComputedStyle(document.documentElement);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#d92b2b';
  ctx.fillRect(food.x * cell, food.y * cell, cell - 1, cell - 1);
  ctx.fillStyle = css.getPropertyValue('--tinta') || '#f2efe6';
  snake.forEach(s => ctx.fillRect(s.x * cell, s.y * cell, cell - 1, cell - 1));
  hud.textContent = 'puntos: ' + score + (pausado ? ' · PAUSA' : '');
}

function girar(x, y) {
  if (x === -dir.x && y === -dir.y) return; // no reversa
  nextDir = { x, y };
}

function init(el) {
  container = el;
  const lado = Math.min(400, container.clientWidth || 400, window.innerWidth - 40);
  cell = Math.floor(lado / COLS);
  canvas = document.createElement('canvas');
  canvas.width = canvas.height = cell * COLS;
  ctx = canvas.getContext('2d');
  hud = document.createElement('p');
  hud.className = 'juego-hud';
  container.append(hud, canvas);

  onKey = (e) => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) e.preventDefault();
    if (k === 'arrowup' || k === 'w') girar(0, -1);
    else if (k === 'arrowdown' || k === 's') girar(0, 1);
    else if (k === 'arrowleft' || k === 'a') girar(-1, 0);
    else if (k === 'arrowright' || k === 'd') girar(1, 0);
    else if (k === ' ') pausado = !pausado;
  };
  onTouchStart = (e) => { touchX0 = e.touches[0].clientX; touchY0 = e.touches[0].clientY; };
  onTouchEnd = (e) => {
    const dx = e.changedTouches[0].clientX - touchX0;
    const dy = e.changedTouches[0].clientY - touchY0;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
    if (Math.abs(dx) > Math.abs(dy)) girar(Math.sign(dx), 0);
    else girar(0, Math.sign(dy));
  };
  onVis = () => { if (document.hidden) pausado = true; dibujar(); };

  window.addEventListener('keydown', onKey);
  canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  canvas.addEventListener('touchend', onTouchEnd);
  document.addEventListener('visibilitychange', onVis);
  reiniciar();
  dibujar();
}

function destroy() {
  clearInterval(timer);
  timer = null;
  window.removeEventListener('keydown', onKey);
  document.removeEventListener('visibilitychange', onVis);
  if (canvas) { canvas.remove(); canvas = null; }
  if (hud) { hud.remove(); hud = null; }
}

export default { init, destroy };
