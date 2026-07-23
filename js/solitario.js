// Solitario Klondike — click-to-move (sin drag&drop): tocas una carta y luego el destino.
// init(container) / destroy(). Victorias en localStorage games.solitario.highscore.
const HS_KEY = 'games.solitario.highscore';
const PALOS = ['♠', '♥', '♦', '♣'];
const ROJO = { '♥': true, '♦': true };
const RANGOS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

let root = null, hud = null;
let stock, waste, found, tab, sel; // sel = {zona, pila, idx}

function mazo() {
  const m = [];
  PALOS.forEach(s => RANGOS.forEach((r, i) => m.push({ r: i + 1, s, up: false })));
  for (let i = m.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [m[i], m[j]] = [m[j], m[i]];
  }
  return m;
}

function repartir() {
  const m = mazo();
  tab = [];
  for (let c = 0; c < 7; c++) {
    tab.push(m.splice(0, c + 1));
    tab[c][tab[c].length - 1].up = true;
  }
  stock = m;
  waste = [];
  found = [[], [], [], []];
  sel = null;
}

function puedeATableau(carta, pila) {
  if (!pila.length) return carta.r === 13; // K en hueco
  const top = pila[pila.length - 1];
  return top.up && top.r === carta.r + 1 && ROJO[top.s] !== ROJO[carta.s];
}

function puedeAFundacion(carta, f) {
  return f.length ? (f[f.length - 1].s === carta.s && f[f.length - 1].r === carta.r - 1) : carta.r === 1;
}

function tomarSeleccion() {
  if (!sel) return null;
  if (sel.zona === 'waste') return [waste[waste.length - 1]];
  if (sel.zona === 'found') return [found[sel.pila][found[sel.pila].length - 1]];
  return tab[sel.pila].slice(sel.idx);
}

function quitarSeleccion() {
  if (sel.zona === 'waste') waste.pop();
  else if (sel.zona === 'found') found[sel.pila].pop();
  else {
    tab[sel.pila].length = sel.idx;
    const p = tab[sel.pila];
    if (p.length && !p[p.length - 1].up) p[p.length - 1].up = true;
  }
}

function checarVictoria() {
  if (found.every(f => f.length === 13)) {
    localStorage.setItem(HS_KEY, (parseInt(localStorage.getItem(HS_KEY), 10) || 0) + 1);
    hud.textContent = '¡GANASTE! — toca "nuevo" para otra partida';
    return true;
  }
  return false;
}

function clickStock() {
  sel = null;
  if (stock.length) {
    const c = stock.pop();
    c.up = true;
    waste.push(c);
  } else {
    stock = waste.reverse().map(c => (c.up = false, c));
    waste = [];
  }
  render();
}

function clickDestino(zona, pila) {
  if (!sel) return;
  const cartas = tomarSeleccion();
  if (!cartas || !cartas.length) { sel = null; render(); return; }
  let ok = false;
  if (zona === 'found' && cartas.length === 1 && puedeAFundacion(cartas[0], found[pila])) {
    quitarSeleccion();
    found[pila].push(cartas[0]);
    ok = true;
  } else if (zona === 'tab' && puedeATableau(cartas[0], tab[pila])) {
    quitarSeleccion();
    tab[pila].push(...cartas);
    ok = true;
  }
  sel = null;
  render();
  if (ok) checarVictoria();
}

function clickCarta(zona, pila, idx) {
  if (sel) {
    // segundo click: intenta mover sobre esta pila
    if (!(sel.zona === zona && sel.pila === pila)) return clickDestino(zona, pila);
    sel = null; render(); return;
  }
  if (zona === 'tab' && !tab[pila][idx].up) return; // boca abajo no se toca
  sel = { zona, pila, idx };
  render();
}

function autoFundacion() {
  let movio = true;
  while (movio) {
    movio = false;
    const fuentes = [['waste', 0, waste], ...tab.map((p, i) => ['tab', i, p])];
    for (const [zona, i, p] of fuentes) {
      if (!p.length) continue;
      const c = p[p.length - 1];
      if (!c.up && zona === 'tab') continue;
      for (let f = 0; f < 4; f++) {
        if (puedeAFundacion(c, found[f])) {
          p.pop();
          found[f].push(c);
          if (zona === 'tab' && p.length && !p[p.length - 1].up) p[p.length - 1].up = true;
          movio = true;
          break;
        }
      }
    }
  }
  sel = null;
  render();
  checarVictoria();
}

function cartaEl(c, zona, pila, idx) {
  const el = document.createElement('button');
  el.className = 'sol-carta' + (ROJO[c.s] ? ' roja' : '') + (c.up ? '' : ' abajo');
  if (sel && sel.zona === zona && sel.pila === pila && (zona !== 'tab' || idx >= sel.idx)) el.classList.add('sel');
  el.textContent = c.up ? RANGOS[c.r - 1] + c.s : '';
  el.addEventListener('click', (e) => { e.stopPropagation(); clickCarta(zona, pila, idx); });
  return el;
}

function render() {
  root.innerHTML = '';

  const top = document.createElement('div');
  top.className = 'sol-fila-top';

  const st = document.createElement('div');
  st.className = stock.length ? 'sol-carta abajo' : 'sol-hueco';
  st.addEventListener('click', clickStock);
  top.append(st);

  const wa = document.createElement('div');
  wa.className = 'sol-pila';
  if (waste.length) wa.append(cartaEl(waste[waste.length - 1], 'waste', 0, waste.length - 1));
  else { const h = document.createElement('div'); h.className = 'sol-hueco'; wa.append(h); }
  top.append(wa);

  const gap = document.createElement('div');
  top.append(gap);

  found.forEach((f, i) => {
    const d = document.createElement('div');
    d.className = 'sol-pila';
    if (f.length) d.append(cartaEl(f[f.length - 1], 'found', i, f.length - 1));
    else {
      const h = document.createElement('div');
      h.className = 'sol-hueco';
      h.addEventListener('click', () => clickDestino('found', i));
      d.append(h);
    }
    top.append(d);
  });
  root.append(top);

  tab.forEach((p, i) => {
    const col = document.createElement('div');
    col.className = 'sol-pila sol-tab';
    col.style.minHeight = (78 + p.length * 20) + 'px';
    if (!p.length) {
      const h = document.createElement('div');
      h.className = 'sol-hueco';
      h.addEventListener('click', () => clickDestino('tab', i));
      col.append(h);
    }
    p.forEach((c, idx) => {
      const el = cartaEl(c, 'tab', i, idx);
      el.style.top = (idx * 20) + 'px';
      el.style.zIndex = idx + 1;
      col.append(el);
    });
    col.addEventListener('click', () => clickDestino('tab', i));
    root.append(col);
  });
}

function init(container) {
  hud = document.createElement('p');
  hud.className = 'juego-hud';
  hud.textContent = 'toca una carta y luego su destino · ';

  const auto = document.createElement('button');
  auto.textContent = 'auto ↑';
  auto.className = 'sol-btn';
  auto.style.cssText = 'background:none;border:1px solid currentColor;color:inherit;font:inherit;font-size:10px;padding:2px 8px;cursor:pointer;margin-right:8px';
  auto.addEventListener('click', autoFundacion);

  const nuevo = document.createElement('button');
  nuevo.textContent = 'nuevo';
  nuevo.style.cssText = auto.style.cssText;
  nuevo.addEventListener('click', () => { repartir(); render(); });

  hud.append(auto, nuevo);

  root = document.createElement('div');
  root.className = 'sol-mesa';
  container.append(hud, root);
  repartir();
  render();
}

function destroy() {
  // sin loops que cancelar (juego por turnos, DOM puro)
  if (root) { root.remove(); root = null; }
  if (hud) { hud.remove(); hud = null; }
}

export default { init, destroy };
