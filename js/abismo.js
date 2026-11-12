/* ABISMO — escena submarina en WebGL para la página beta. Sin librerías.

   Qué dibuja, de atrás hacia adelante:
   1. el agua: degradado que se oscurece al bajar, rayos de luz desde la superficie y grano;
   2. el fondo del mar (un desierto hundido: dunas, saguaros, una rueda de carreta);
   3. fotos de assets/fuji a la deriva, como recuerdos hundidos;
   4. las "reliquias": un objeto 3D por sección (disco, sombrero, herradura, estrella,
      dado, botella). Cada una se dibuja exactamente encima de su hueco en el HTML
      (<div class="reliquia" data-obj="...">), así que el layout lo manda el CSS;
   5. medusas, nieve marina y burbujas.

   La cámara baja con el scroll: 1 alto de pantalla = HV unidades de mundo en el plano
   z = 0, por eso lo que está en z = 0 se mueve igual que la página y lo que está más
   lejos se mueve más lento (paralaje real, no simulado).

   Uso:  const escena = iniciar(canvas, { reliquias, fotos, reducir, alCuadro });
   Devuelve null si el navegador no tiene WebGL (la página funciona igual, sin 3D). */

const TAU = Math.PI * 2;
const HV = 10;                       // unidades de mundo que caben en el alto de la pantalla (plano z = 0)
const FOV = 40 * Math.PI / 180;
const DIST = (HV / 2) / Math.tan(FOV / 2);   // distancia de la cámara al plano z = 0

/* ---------------------------------------------------------------- matrices 4x4 (columna mayor) */
const M4 = {
  ident: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  },
  persp(fovy, asp, n, f) {
    const t = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
    o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f);
    return o;
  },
  tras(x, y, z) { const o = M4.ident(); o[12] = x; o[13] = y; o[14] = z; return o; },
  esc(s) { const o = M4.ident(); o[0] = o[5] = o[10] = s; return o; },
  rotX(a) { const o = M4.ident(), c = Math.cos(a), s = Math.sin(a); o[5] = c; o[6] = s; o[9] = -s; o[10] = c; return o; },
  rotY(a) { const o = M4.ident(), c = Math.cos(a), s = Math.sin(a); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o; },
  rotZ(a) { const o = M4.ident(), c = Math.cos(a), s = Math.sin(a); o[0] = c; o[1] = s; o[4] = -s; o[5] = c; return o; },
  encadena(...ms) { return ms.reduce((a, b) => M4.mul(a, b)); },
};

/* ---------------------------------------------------------------- geometría procedural
   Cada generador devuelve { p: [[x,y,z]...], t: [[a,b,c]...] } con vértices compartidos. */

// superficie de revolución alrededor del eje Y; perfil = [[radio, y], ...]
function torno(perfil, seg) {
  const p = [], t = [], n = perfil.length;
  for (let i = 0; i < seg; i++) {
    const a = i / seg * TAU, c = Math.cos(a), s = Math.sin(a);
    for (let j = 0; j < n; j++) p.push([perfil[j][0] * c, perfil[j][1], perfil[j][0] * s]);
  }
  for (let i = 0; i < seg; i++) {
    const i2 = (i + 1) % seg;
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j, b = i2 * n + j;
      t.push([a, b, a + 1], [a + 1, b, b + 1]);
    }
  }
  return { p, t };
}

// arco de toro en el plano XY (aplasta < 1 lo vuelve una barra plana); con tapas si no cierra
function toro(R, r, su, sv, a0, a1, aplasta) {
  const p = [], t = [], cerrado = Math.abs((a1 - a0) - TAU) < 1e-6, nu = cerrado ? su : su + 1;
  for (let i = 0; i < nu; i++) {
    const u = a0 + (a1 - a0) * i / su, cu = Math.cos(u), sn = Math.sin(u);
    for (let j = 0; j < sv; j++) {
      const v = j / sv * TAU, rr = R + r * Math.cos(v);
      p.push([rr * cu, rr * sn, r * Math.sin(v) * aplasta]);
    }
  }
  for (let i = 0; i < su; i++) {
    const i2 = cerrado ? (i + 1) % su : i + 1;
    for (let j = 0; j < sv; j++) {
      const j2 = (j + 1) % sv, a = i * sv + j, b = i2 * sv + j, c = i * sv + j2, d = i2 * sv + j2;
      t.push([a, b, c], [c, b, d]);
    }
  }
  if (!cerrado) {
    [[0, false], [su, true]].forEach(([i, voltea]) => {
      const u = a0 + (a1 - a0) * i / su, ci = p.length;
      p.push([R * Math.cos(u), R * Math.sin(u), 0]);
      for (let j = 0; j < sv; j++) {
        const j2 = (j + 1) % sv;
        t.push(voltea ? [ci, i * sv + j, i * sv + j2] : [ci, i * sv + j2, i * sv + j]);
      }
    });
  }
  return { p, t };
}

function esfera(r, seg) {
  const perfil = [];
  for (let j = 0; j <= seg; j++) { const a = -Math.PI / 2 + Math.PI * j / seg; perfil.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return torno(perfil, seg * 2);
}

function capsula(r, h, seg) {
  const perfil = [], k = 5;
  for (let j = 0; j <= k; j++) { const a = -Math.PI / 2 + (Math.PI / 2) * j / k; perfil.push([Math.cos(a) * r, Math.sin(a) * r]); }
  for (let j = 0; j <= k; j++) { const a = (Math.PI / 2) * j / k; perfil.push([Math.cos(a) * r, h + Math.sin(a) * r]); }
  return torno(perfil, seg);
}

const cilindro = (r, y0, y1, seg) => torno([[0, y0], [r, y0], [r, y1], [0, y1]], seg);

// cubo de lado 2 con caras subdivididas e "inflado" hacia una esfera (redondeo 0..1)
function cuboRedondo(n, redondeo) {
  const p = [], t = [], mapa = new Map();
  const idx = (v) => {
    const k = v.map((x) => x.toFixed(4)).join(',');
    if (!mapa.has(k)) { mapa.set(k, p.length); p.push(v); }
    return mapa.get(k);
  };
  const caras = [[0, 1, 2, 1], [0, 1, 2, -1], [1, 2, 0, 1], [1, 2, 0, -1], [2, 0, 1, 1], [2, 0, 1, -1]];
  caras.forEach(([a, b, c, s]) => {
    const g = [];
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const v = [0, 0, 0]; v[a] = -1 + 2 * i / n; v[b] = -1 + 2 * j / n; v[c] = s;
      const l = Math.hypot(v[0], v[1], v[2]), e = 1.32;
      g.push(idx(v.map((x) => x * (1 - redondeo) + (x / l) * e * redondeo)));
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const q = i * (n + 1) + j;
      if (s > 0) t.push([g[q], g[q + n + 1], g[q + 1]], [g[q + 1], g[q + n + 1], g[q + n + 2]]);
      else t.push([g[q], g[q + 1], g[q + n + 1]], [g[q + 1], g[q + n + 2], g[q + n + 1]]);
    }
  });
  return { p, t };
}

// estrella de puntas facetadas (centro levantado), en el plano XY
function estrella(puntas, rExt, rInt, canto, alto) {
  const p = [[0, 0, alto], [0, 0, -alto * 0.55]], t = [], n = puntas * 2;
  for (let i = 0; i < n; i++) {
    const a = Math.PI / 2 + i / n * TAU, r = i % 2 ? rInt : rExt;
    p.push([Math.cos(a) * r, Math.sin(a) * r, canto]);
  }
  for (let i = 0; i < n; i++) {
    const a = Math.PI / 2 + i / n * TAU, r = i % 2 ? rInt : rExt;
    p.push([Math.cos(a) * r, Math.sin(a) * r, -canto]);
  }
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n, f = 2 + i, f2 = 2 + i2, b = 2 + n + i, b2 = 2 + n + i2;
    t.push([0, f, f2], [1, b2, b], [f, b, f2], [f2, b, b2]);
  }
  return { p, t };
}

function rejilla(x0, x1, z0, z1, nx, nz, altura) {
  const p = [], t = [];
  for (let i = 0; i <= nz; i++) for (let j = 0; j <= nx; j++) {
    const x = x0 + (x1 - x0) * j / nx, z = z0 + (z1 - z0) * i / nz;
    p.push([x, altura(x, z), z]);
  }
  for (let i = 0; i < nz; i++) for (let j = 0; j < nx; j++) {
    const a = i * (nx + 1) + j, b = a + nx + 1;
    t.push([a, b, a + 1], [a + 1, b, b + 1]);
  }
  return { p, t };
}

/* Junta geometrías en una malla lista para la GPU. Cada pieza puede ir con sombreado
   suave (normales promediadas) o plano (facetas), con su color y su transformación. */
class Malla {
  constructor() { this.pos = []; this.nor = []; this.col = []; }

  // color: [r,g,b,(mascara)] o función (vértice, índice) → color. M: matriz de rotación/traslación/escala pareja.
  agrega(geo, color, M, plano) {
    const { p, t } = geo, colorDe = typeof color === 'function' ? color : () => color;
    let normales = null;
    if (!plano) {
      normales = p.map(() => [0, 0, 0]);
      t.forEach(([a, b, c]) => {
        const n = normalCara(p[a], p[b], p[c]);
        [a, b, c].forEach((i) => { normales[i][0] += n[0]; normales[i][1] += n[1]; normales[i][2] += n[2]; });
      });
    }
    t.forEach(([a, b, c]) => {
      const nc = plano ? unidad(normalCara(p[a], p[b], p[c])) : null;
      if (plano && !nc) return;                       // triángulo degenerado
      [a, b, c].forEach((i) => {
        const v = M ? aplica(M, p[i], 1) : p[i];
        let n = plano ? nc : (unidad(normales[i]) || [0, 1, 0]);
        if (M) n = unidad(aplica(M, n, 0)) || n;
        const k = colorDe(p[i], i);
        this.pos.push(v[0], v[1], v[2]); this.nor.push(n[0], n[1], n[2]);
        this.col.push(k[0], k[1], k[2], k.length > 3 ? k[3] : 1);
      });
    });
    return this;
  }

  sube(gl) {
    const b = (datos) => { const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(datos), gl.STATIC_DRAW); return buf; };
    return { pos: b(this.pos), nor: b(this.nor), col: b(this.col), n: this.pos.length / 3 };
  }
}
function normalCara(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}
function unidad(v) { const l = Math.hypot(v[0], v[1], v[2]); return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : null; }
function aplica(M, v, w) {
  return [M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12] * w, M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13] * w, M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14] * w];
}
const suave = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* ---------------------------------------------------------------- los modelos
   Todos caben en una esfera de radio ~1 alrededor del origen. */

const NARANJA = [1.0, 0.40, 0.0];

function modeloDisco() {
  // CD: anillo delgado; la máscara (4º valor del color) dice cuánto tornasol lleva cada zona
  const perfil = [[0.13, -0.012], [0.30, -0.012], [0.30, -0.0121], [1.0, -0.012], [1.0, 0.012], [0.30, 0.0121], [0.30, 0.012], [0.13, 0.012], [0.13, -0.012]];
  const g = torno(perfil, 72);
  return new Malla().agrega(g, (v) => (Math.hypot(v[0], v[2]) < 0.305 ? [0.55, 0.68, 0.72, 0.18] : [0.86, 0.92, 0.96, 1]), null, true);
}

function modeloSombrero() {
  // sombrero vaquero: se tornea un sombrero redondo y luego se deforma (ala curvada, copa hendida)
  const perfil = [[1.0, 0.05], [0.97, 0.02], [0.80, 0.0], [0.585, 0.0], [0.56, 0.02], [0.548, 0.13], [0.54, 0.14], [0.52, 0.34], [0.485, 0.52], [0.42, 0.63], [0.30, 0.68], [0.15, 0.69], [0, 0.69]];
  const g = torno(perfil, 56);
  const banda = g.p.map((v) => v[1] > 0.015 && v[1] < 0.135 && Math.hypot(v[0], v[2]) < 0.6);
  g.p = g.p.map(([x, y, z]) => {
    const r = Math.hypot(x, z) || 1e-6, ala = suave(0.56, 1.0, r), cx = x / r, cz = z / r;
    let ny = y + ala * (0.34 * cx * cx - 0.07 * cz * cz);                 // el ala sube a los lados y cae un poco al frente
    const arriba = suave(0.42, 0.69, y);
    ny -= 0.13 * arriba * Math.exp(-(x * x) / 0.018);                     // hendidura central de la copa
    let nx = x * 0.86;                                                    // copa y ala más angostas que largas
    if (z > 0) nx *= 1 - 0.22 * suave(0.2, 0.69, y) * suave(0.0, 0.5, z); // pellizco al frente
    return [nx, ny - 0.3, z];
  });
  return new Malla().agrega(g, (v, i) => (banda[i] ? NARANJA : [0.50, 0.43, 0.34]));
}

function modeloHerradura() {
  const m = new Malla();
  m.agrega(toro(0.74, 0.15, 44, 12, -0.62, Math.PI + 0.62, 0.42), [0.80, 0.86, 0.90, 1]);
  // agujeros de los clavos
  [-0.25, 0.25, 0.75, Math.PI - 0.75, Math.PI - 0.25, Math.PI + 0.25].forEach((a) => {
    const M = M4.encadena(M4.tras(Math.cos(a) * 0.74, Math.sin(a) * 0.74, 0), M4.rotX(Math.PI / 2));
    m.agrega(cilindro(0.04, -0.07, 0.07, 10), [0.03, 0.04, 0.05, 0], M, true);
  });
  // la herradura se cuelga con la abertura hacia arriba
  const g = new Malla(), R = M4.rotZ(Math.PI);
  for (let i = 0; i < m.pos.length; i += 3) {
    const v = aplica(R, [m.pos[i], m.pos[i + 1] - 0.16, m.pos[i + 2]], 1), n = aplica(R, [m.nor[i], m.nor[i + 1], m.nor[i + 2]], 0);
    g.pos.push(v[0], v[1], v[2]); g.nor.push(n[0], n[1], n[2]);
  }
  g.col = m.col;
  return g;
}

function modeloEstrella() {
  const m = new Malla(), ORO = [1.0, 0.80, 0.40, 1];
  m.agrega(estrella(6, 0.92, 0.50, 0.035, 0.20), ORO, null, true);
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 + i / 6 * TAU;
    m.agrega(esfera(0.085, 7), ORO, M4.tras(Math.cos(a) * 0.96, Math.sin(a) * 0.96, 0));
  }
  return m;
}

function modeloDado() {
  const m = new Malla(), L = 0.62;
  m.agrega(cuboRedondo(6, 0.22), [0.90, 0.86, 0.78], M4.esc(L));
  const punto = esfera(0.085, 6), q = 0.30, cara = L * 1.02;
  const caras = {            // eje fijo, signo, puntos (u, v)
    1: [[0, 0]], 6: [[-q, -q], [-q, 0], [-q, q], [q, -q], [q, 0], [q, q]],
    2: [[-q, -q], [q, q]], 5: [[-q, -q], [q, q], [-q, q], [q, -q], [0, 0]],
    3: [[-q, -q], [0, 0], [q, q]], 4: [[-q, -q], [q, q], [-q, q], [q, -q]],
  };
  const pon = (n, eje, s) => caras[n].forEach(([u, v]) => {
    const c = [0, 0, 0]; c[eje] = s * cara; c[(eje + 1) % 3] = u; c[(eje + 2) % 3] = v;
    m.agrega(punto, [0.05, 0.05, 0.06], M4.tras(c[0], c[1], c[2]));
  });
  pon(1, 1, 1); pon(6, 1, -1); pon(2, 0, 1); pon(5, 0, -1); pon(3, 2, 1); pon(4, 2, -1);
  return m;
}

function modeloBotella() {
  const vidrio = torno([[0, -0.90], [0.34, -0.90], [0.385, -0.86], [0.385, 0.12], [0.35, 0.30], [0.17, 0.50], [0.135, 0.58], [0.135, 0.80], [0.165, 0.82], [0.165, 0.89], [0.12, 0.89]], 36);
  const dentro = new Malla();
  dentro.agrega(cilindro(0.115, 0.76, 0.99, 14), [0.42, 0.29, 0.17], null, true);                                             // corcho
  const inclinado = M4.encadena(M4.tras(0.03, -0.12, 0), M4.rotZ(0.12));
  dentro.agrega(cilindro(0.105, -0.52, 0.30, 16), [0.90, 0.85, 0.72], inclinado);                                             // el mensaje, enrollado
  dentro.agrega(cilindro(0.112, -0.16, -0.08, 16), NARANJA, inclinado);                                                       // su listón
  return { vidrio: new Malla().agrega(vidrio, [0.55, 0.92, 0.86]), dentro };
}

const alturaDuna = (x, z) => 0.38 * Math.sin(x * 0.33 + z * 0.12) + 0.26 * Math.sin(z * 0.47 - x * 0.19) + 0.10 * Math.sin(x * 1.3 + z * 0.9);

function modeloFondo() {
  const m = new Malla();
  m.agrega(rejilla(-34, 34, -46, 9, 64, 44, alturaDuna), [0.33, 0.38, 0.36]);
  // saguaros: tronco y brazos hechos con cápsulas; las costillas salen de alternar el tono por gajo
  const verde = (seg) => (v) => { const g = Math.round((Math.atan2(v[2], v[0]) / TAU + 1) * seg) % 2; return g ? [0.15, 0.36, 0.30] : [0.22, 0.50, 0.42]; };
  const saguaro = (x, z, s, brazos) => {
    const base = M4.encadena(M4.tras(x, alturaDuna(x, z) - 0.15, z), M4.esc(s));
    m.agrega(capsula(0.17, 1.9, 14), verde(14), base);
    brazos.forEach(([lado, alto, largo]) => {
      const codo = M4.encadena(base, M4.tras(lado * 0.17, alto, 0), M4.rotZ(-lado * Math.PI / 2));
      m.agrega(capsula(0.12, 0.34, 12), verde(12), codo);
      m.agrega(capsula(0.12, largo, 12), verde(12), M4.encadena(base, M4.tras(lado * 0.52, alto, 0)));
    });
  };
  saguaro(-1.75, -3.4, 1.15, [[1, 0.8, 0.7], [-1, 1.05, 0.5]]);
  saguaro(2.7, -7.5, 1.6, [[-1, 0.7, 0.8], [1, 1.1, 0.45]]);
  saguaro(-4.1, -11, 2.0, [[1, 0.9, 0.6]]);
  saguaro(4.9, -15, 2.0, [[-1, 0.8, 0.7], [1, 0.6, 0.9]]);
  saguaro(0.3, -20, 2.5, [[1, 1.0, 0.5], [-1, 0.75, 0.75]]);
  saguaro(-8.8, -17, 2.4, [[-1, 0.9, 0.6], [1, 0.6, 0.8]]);
  saguaro(9.5, -22, 2.8, [[1, 0.8, 0.8], [-1, 1.1, 0.4]]);
  saguaro(-15, -26, 3.0, [[1, 0.9, 0.7]]);
  saguaro(16, -29, 3.2, [[-1, 0.8, 0.8], [1, 1.1, 0.4]]);
  // rueda de carreta medio enterrada
  const madera = [0.27, 0.20, 0.15];
  const rueda = M4.encadena(M4.tras(1.55, alturaDuna(1.55, -1.3) + 0.42, -1.3), M4.rotY(0.5), M4.rotX(-0.5), M4.esc(0.95));
  m.agrega(toro(0.9, 0.075, 36, 8, 0, TAU, 1), madera, rueda);
  m.agrega(M4rot(cilindro(0.16, -0.09, 0.09, 12)), madera, rueda);
  for (let i = 0; i < 8; i++) m.agrega(cilindro(0.035, 0.14, 0.86, 6), madera, M4.encadena(rueda, M4.rotZ(i / 8 * TAU)));
  return m;
}
// gira una geometría torneada (eje Y) para que su eje quede en Z
function M4rot(geo) { return { p: geo.p.map(([x, y, z]) => [x, -z, y]), t: geo.t }; }

/* ---------------------------------------------------------------- shaders */

const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

// colores del agua según la profundidad (0 = superficie, 1 = fondo); los usan el fondo y la niebla
const GLSL_AGUA = `
vec3 aguaArriba(float prof){ return mix(vec3(0.030, 0.230, 0.270), vec3(0.004, 0.022, 0.032), smoothstep(0.0, 0.75, prof)); }
vec3 aguaAbajo(float prof){ return mix(vec3(0.006, 0.060, 0.080), vec3(0.000, 0.005, 0.010), smoothstep(0.0, 0.75, prof)); }
`;

// cáusticas: el dibujo de luz que hace el oleaje sobre lo que está abajo
const GLSL_CAUSTICA = `
float caustica(vec2 uv, float tiempo){
  vec2 p = mod(uv * 6.28318530718, 6.28318530718) - 250.0;
  vec2 i = p; float c = 1.0; const float inten = 0.005;
  for (int n = 0; n < 3; n++) {
    float t = tiempo * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 3.0; c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
`;

const VS_FONDO = `attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;
const FS_FONDO = PRECISION + GLSL_AGUA + `
uniform vec2 uRes; uniform float uT, uProf, uAlfa;
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 col = mix(aguaAbajo(uProf), aguaArriba(uProf), pow(uv.y, 1.25));
  // rayos de luz que bajan desde la superficie; se apagan con la profundidad
  vec2 p = vec2((uv.x - 0.5) * uRes.x / uRes.y, uv.y);
  vec2 d = p - vec2(0.18, 1.55);
  float ang = atan(d.x, -d.y);
  float rayos = (0.5 + 0.5 * sin(ang * 17.0 + uT * 0.21)) * (0.5 + 0.5 * sin(ang * 29.0 - uT * 0.15 + 1.3)) * (0.6 + 0.4 * sin(ang * 7.0 + uT * 0.09));
  float caida = smoothstep(1.75, 0.25, length(d));
  float luz = 1.0 - smoothstep(0.0, 0.42, uProf);
  col += vec3(0.10, 0.36, 0.38) * rayos * rayos * caida * luz * 0.85;
  col += vec3(0.05, 0.16, 0.17) * smoothstep(0.55, 1.0, uv.y) * luz * 0.6;
  // en el fondo, un resplandor tenue en el horizonte: los saguaros se recortan contra él
  float hz = (uv.y - 0.50) * 7.0;
  col += vec3(0.020, 0.115, 0.125) * exp(-hz * hz) * smoothstep(0.86, 1.0, uProf);
  // viñeta y grano
  float v = smoothstep(1.2, 0.3, length(vec2((uv.x - 0.5) * 1.05, uv.y - 0.52)));
  col *= mix(0.5, 1.0, v);
  col += (fract(sin(dot(gl_FragCoord.xy + uT * 61.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.02;
  gl_FragColor = vec4(col * uAlfa, uAlfa);
}`;

const VS_OBJ = `
attribute vec3 aPos; attribute vec3 aNor; attribute vec4 aCol;
uniform mat4 uVP, uM;
varying vec3 vW, vN, vO, vCentro; varying vec4 vC;
void main(){
  vec4 w = uM * vec4(aPos, 1.0);
  vW = w.xyz; vN = (uM * vec4(aNor, 0.0)).xyz; vO = aPos; vC = aCol;
  vCentro = (uM * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  gl_Position = uVP * w;
}`;
const FS_OBJ = PRECISION + GLSL_AGUA + GLSL_CAUSTICA + `
uniform vec3 uCam, uEmis;
uniform float uT, uProf, uMetal, uIrid, uRim, uCalido, uSolMin, uAlfa, uVidrio, uNiebla;
varying vec3 vW, vN, vO, vCentro; varying vec4 vC;
void main(){
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCam - vW);
  vec3 L = normalize(vec3(0.25, 1.0, 0.5));            // la luz viene de la superficie
  vec3 Lc = normalize(vec3(-0.65, -0.25, 0.72));       // y una brasa naranja, desde abajo a la izquierda
  float nl = dot(N, L);
  float medio = nl * 0.5 + 0.5; medio *= medio;
  float sol = max(1.0 - smoothstep(0.0, 0.8, uProf), uSolMin);
  float ca = caustica(vW.xz * 0.16 + vec2(vW.y * 0.05), uT * 0.55) * max(nl, 0.0) * sol;
  vec3 amb = mix(vec3(0.030, 0.085, 0.100), vec3(0.016, 0.040, 0.055), uProf);
  vec3 luz = amb + vec3(0.36, 0.78, 0.80) * medio * (0.30 + 0.70 * sol) + vec3(0.65, 1.0, 0.95) * ca * 1.5;
  float nc = max(dot(N, Lc), 0.0);
  luz += vec3(1.0, 0.42, 0.04) * nc * nc * uCalido;
  vec3 col = vC.rgb * luz;

  // cromo: un entorno inventado (oscuro abajo, agua arriba, un punto caliente naranja)
  vec3 R = reflect(-V, N);
  vec3 ent = mix(vec3(0.00, 0.03, 0.04), vec3(0.28, 0.80, 0.84), smoothstep(0.30, 0.95, R.y * 0.5 + 0.5));
  ent *= 0.72 + 0.55 * (0.5 + 0.5 * sin(R.y * 9.0 + R.x * 4.0 + R.z * 2.0));
  ent += vec3(1.0, 0.48, 0.08) * smoothstep(0.72, 1.0, dot(R, Lc)) * 1.1;
  float espec = pow(max(dot(R, L), 0.0), 36.0) * (0.35 + 0.65 * sol);
  ent += vec3(0.9, 1.0, 1.0) * espec * 1.6;
  ent *= 0.55 + 0.45 * sol;
  float metal = uMetal * vC.a;
  float tinte = max(vC.r, max(vC.g, vC.b)) - min(vC.r, min(vC.g, vC.b));
  vec3 reflejo = mix(ent * mix(vec3(1.0), vC.rgb, 0.7), vC.rgb * (dot(ent, vec3(0.30, 0.45, 0.25)) * 2.2 + 0.05), smoothstep(0.15, 0.5, tinte));
  col = mix(col, reflejo, metal);

  // tornasol del disco: el color depende del ángulo alrededor del centro y de cómo se mira
  float ir = uIrid * vC.a;
  if (ir > 0.0) {
    vec3 d = vW - vCentro;
    float ang = atan(d.y, d.x);
    float radio = length(vO.xz);
    float h = ang / 6.2831853 * 2.0 + dot(V, N) * 1.8 + radio * 1.2;
    vec3 arco = 0.5 + 0.5 * cos(6.2831853 * (h + vec3(0.0, 0.33, 0.67)));
    float surcos = 0.80 + 0.20 * sin(radio * 150.0);
    float haz = pow(abs(cos(ang - 0.9 + dot(V, N) * 1.5)), 26.0);            // las dos cuñas de luz de un CD
    float brillo = 0.34 + 0.9 * pow(max(dot(N, normalize(L + V)), 0.0), 3.0) + 0.45 * pow(1.0 - abs(dot(N, V)), 2.0);
    col = mix(col, arco * brillo * surcos + ent * 0.22 + vec3(0.95, 1.0, 1.0) * haz * 0.75, ir * 0.88);
  }

  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += mix(vec3(0.16, 0.58, 0.62), vec3(0.06, 0.32, 0.42), uProf) * fres * uRim;
  col += uEmis;

  float dist = length(uCam - vW);
  float niebla = clamp(1.0 - exp(-max(dist - 13.0, 0.0) * uNiebla), 0.0, 1.0);
  col = mix(col, mix(aguaAbajo(uProf), aguaArriba(uProf), 0.45), niebla);
  float a = clamp(uAlfa + (fres * 0.75 + espec) * uVidrio, 0.0, 1.0);
  gl_FragColor = vec4(col * a, a);
}`;

const VS_NIEVE = `
attribute vec4 aP;
uniform mat4 uVP; uniform float uT, uCamY, uPx;
varying float vA, vS;
void main(){
  const float R = 26.0;
  vec3 p = aP.xyz;
  float s = aP.w;
  p.x += sin(uT * 0.11 + s * 40.0) * 0.6;
  p.z += cos(uT * 0.07 + s * 23.0) * 0.5;
  p.y -= uT * (0.04 + 0.10 * fract(s * 7.3));
  p.y = mod(p.y - uCamY, R) - R * 0.5 + uCamY;
  vec4 c = uVP * vec4(p, 1.0);
  gl_Position = c;
  float tam = clamp((0.035 + 0.075 * fract(s * 13.7)) * uPx / max(c.w, 0.1), 1.0, 42.0);
  gl_PointSize = tam;
  float orilla = 1.0 - smoothstep(R * 0.36, R * 0.5, abs(p.y - uCamY));
  float titila = 0.65 + 0.35 * sin(uT * (0.4 + fract(s * 5.0)) + s * 100.0);
  vA = orilla * (0.22 + 0.55 * fract(s * 3.1)) * titila * mix(1.0, 0.32, smoothstep(6.0, 30.0, tam));
  vS = fract(s * 17.0);
}`;
const FS_NIEVE = PRECISION + `
uniform float uProf;
varying float vA, vS;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.15, d) * vA;
  // en lo hondo, algunas motas brillan (bioluminiscencia)
  vec3 col = mix(vec3(0.70, 0.90, 0.90), vec3(0.35, 1.0, 0.90), step(0.78, vS) * smoothstep(0.25, 0.7, uProf));
  a *= mix(1.0, 1.7, step(0.78, vS) * smoothstep(0.25, 0.7, uProf));
  gl_FragColor = vec4(col * a, a);
}`;

const VS_BURBUJA = `
attribute vec4 aP; attribute float aA;
uniform mat4 uVP; uniform float uPx;
varying float vA;
void main(){
  vec4 c = uVP * vec4(aP.xyz, 1.0);
  gl_Position = c; gl_PointSize = clamp(aP.w * uPx / max(c.w, 0.1), 2.0, 64.0); vA = aA;
}`;
const FS_BURBUJA = PRECISION + `
varying float vA;
void main(){
  vec2 q = gl_PointCoord - 0.5; float d = length(q) * 2.0;
  float aro = smoothstep(1.0, 0.92, d) * smoothstep(0.62, 0.95, d);
  float brillo = smoothstep(0.30, 0.0, length(q - vec2(-0.16, -0.18)));
  float a = (aro * 0.7 + brillo * 0.9 + smoothstep(1.0, 0.0, d) * 0.06) * vA;
  gl_FragColor = vec4(vec3(0.78, 1.0, 0.98) * a, a);
}`;

const VS_FOTO = `
attribute vec2 aPos;
uniform mat4 uVP, uM;
varying vec2 vUV; varying vec3 vW;
void main(){
  vec4 w = uM * vec4(aPos.x * 1.333, aPos.y, 0.0, 1.0);
  vW = w.xyz; vUV = aPos * 0.5 + 0.5;
  gl_Position = uVP * w;
}`;
const FS_FOTO = PRECISION + GLSL_AGUA + `
uniform sampler2D uTex; uniform vec3 uCam; uniform float uProf, uAlfa, uNiebla;
varying vec2 vUV; varying vec3 vW;
void main(){
  // la foto lleva su orilla de papel
  vec2 m = vec2(0.045, 0.06);
  vec2 uv = (vUV - m) / (1.0 - 2.0 * m);
  vec3 col = vec3(0.86, 0.90, 0.88);
  if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) col = texture2D(uTex, uv).rgb;
  col = mix(vec3(dot(col, vec3(0.3, 0.6, 0.1))), col, 0.55) * vec3(0.55, 0.86, 0.90);   // lavada por el agua
  col *= mix(0.95, 0.55, uProf);
  float dist = length(uCam - vW);
  float niebla = clamp(1.0 - exp(-max(dist - 13.0, 0.0) * uNiebla), 0.0, 1.0);
  col = mix(col, mix(aguaAbajo(uProf), aguaArriba(uProf), 0.45), niebla);
  gl_FragColor = vec4(col * uAlfa, uAlfa);
}`;

const VS_MEDUSA = `
attribute vec3 aPos; attribute vec3 aNor; attribute vec2 aAux;
uniform mat4 uVP; uniform vec3 uPosM; uniform float uT, uEsc, uFase;
varying vec3 vN, vW; varying float vL;
void main(){
  vec3 p = aPos;
  float pulso = sin(uT * 1.5 + uFase);
  if (aAux.x < 0.0) {                       // campana
    p.xz *= 1.0 + 0.13 * pulso * (1.0 - p.y * 1.6);
    p.y *= 1.0 - 0.07 * pulso;
    vL = -1.0;
  } else {                                  // tentáculos: ondean más hacia la punta
    float a = aAux.x;
    p.x += sin(uT * 1.2 + a * 5.0 + aAux.y * 6.28 + uFase) * 0.16 * a;
    p.z += cos(uT * 1.0 + a * 4.0 + aAux.y * 4.0 + uFase) * 0.16 * a;
    p.xz *= 1.0 + 0.13 * pulso * (1.0 - a);
    vL = a;
  }
  vW = uPosM + p * uEsc; vN = aNor;
  gl_Position = uVP * vec4(vW, 1.0);
}`;
const FS_MEDUSA = PRECISION + `
uniform vec3 uCam, uColor; uniform float uBrillo;
varying vec3 vN, vW; varying float vL;
void main(){
  vec3 V = normalize(uCam - vW);
  float a;
  if (vL < 0.0) { float f = 1.0 - abs(dot(normalize(vN), V)); a = 0.10 + 0.9 * f * f; }
  else a = 0.5 * (1.0 - vL) * (1.0 - vL);
  float dist = length(uCam - vW);
  a *= uBrillo * exp(-max(dist - 13.0, 0.0) * 0.055);
  gl_FragColor = vec4(uColor * a, a);
}`;

// linternas: puntos de luz naranja que rondan en lo hondo (algo con luz propia anda por ahí)
const VS_LUZ = `
attribute vec2 aPos;
uniform mat4 uVP; uniform vec3 uCentro; uniform float uTam;
varying vec2 vQ;
void main(){ vQ = aPos; gl_Position = uVP * vec4(uCentro + vec3(aPos * uTam, 0.0), 1.0); }`;
const FS_LUZ = PRECISION + `
uniform float uBrillo;
varying vec2 vQ;
void main(){
  float d = length(vQ);
  float a = (exp(-d * d * 26.0) * 1.3 + exp(-d * d * 4.5) * 0.30) * smoothstep(1.0, 0.7, d) * uBrillo;
  gl_FragColor = vec4(vec3(1.0, 0.42, 0.05) * a, 0.0);
}`;

/* ---------------------------------------------------------------- arranque */

function programa(gl, vs, fs) {
  const compila = (tipo, src) => {
    const s = gl.createShader(tipo); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compila(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compila(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('programa: ' + gl.getProgramInfoLog(p));
  const u = {}, a = {};
  for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { const d = gl.getActiveUniform(p, i); u[d.name] = gl.getUniformLocation(p, d.name); }
  for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); i < n; i++) { const d = gl.getActiveAttrib(p, i); a[d.name] = gl.getAttribLocation(p, d.name); }
  return { p, u, a };
}

/* Cómo se ve y se mueve cada reliquia (ángulos en radianes; "vuelta" = rad/s).
   modo: 'gira'   da vueltas como una moneda colgada;
         'trompo' gira sobre su propio eje, siempre inclinada hacia quien mira (el sombrero se ve desde arriba);
         'mece'   no da la vuelta sola: se balancea de frente (el disco nunca queda de canto);
         'tumba'  rueda sobre sí misma (el dado). */
const RELIQUIAS = {
  disco:     { metal: 0.55, irid: 1, rim: 0.5, calido: 0.5, base: [1.32, 0, 0], vuelta: 0.45, mece: 0.22, modo: 'mece' },
  sombrero:  { metal: 0, irid: 0, rim: 0.95, calido: 0.55, base: [0.50, 0, 0.05], vuelta: 0.32, mece: 0.10, modo: 'trompo' },
  herradura: { metal: 1, irid: 0, rim: 0.35, calido: 0.7, base: [0.10, 0, 0], vuelta: 0.38, mece: 0.10, modo: 'gira' },
  estrella:  { metal: 1, irid: 0, rim: 0.30, calido: 0.8, base: [0.10, 0, 0], vuelta: 0.42, mece: 0.12, modo: 'gira' },
  dado:      { metal: 0, irid: 0, rim: 0.8, calido: 0.5, base: [0.5, 0, 0.3], vuelta: 0.33, mece: 0.25, modo: 'tumba' },
  botella:   { metal: 0, irid: 0, rim: 0.9, calido: 0.5, base: [0.15, 0, 0.55], vuelta: 0.22, mece: 0.16, modo: 'gira' },
};

export function iniciar(canvas, op) {
  op = op || {};
  let gl = null;
  try { gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, powerPreference: 'high-performance' }); } catch (e) { /* sin WebGL */ }
  if (!gl) return null;

  const movil = Math.min(window.innerWidth, window.innerHeight) < 700;
  const reducir = !!op.reducir;
  let P;
  try {
    P = {
      fondo: programa(gl, VS_FONDO, FS_FONDO), obj: programa(gl, VS_OBJ, FS_OBJ), nieve: programa(gl, VS_NIEVE, FS_NIEVE),
      burbuja: programa(gl, VS_BURBUJA, FS_BURBUJA), foto: programa(gl, VS_FOTO, FS_FOTO), medusa: programa(gl, VS_MEDUSA, FS_MEDUSA),
      luz: programa(gl, VS_LUZ, FS_LUZ),
    };
  } catch (e) { console.warn('[abismo] sin 3D:', e.message); return null; }

  /* ---- geometría a la GPU ---- */
  const buf = (datos) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, datos, gl.STATIC_DRAW); return b; };
  const triFondo = buf(new Float32Array([-1, -1, 3, -1, -1, 3]));
  const cuadro = buf(new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]));
  const botella = modeloBotella();
  const mallas = {
    disco: modeloDisco().sube(gl), sombrero: modeloSombrero().sube(gl), herradura: modeloHerradura().sube(gl),
    estrella: modeloEstrella().sube(gl), dado: modeloDado().sube(gl),
    botella: botella.dentro.sube(gl), botellaVidrio: botella.vidrio.sube(gl), fondo: modeloFondo().sube(gl),
  };

  // nieve marina: posiciones base en una caja; el shader las recicla alrededor de la cámara
  const N_NIEVE = reducir ? 120 : (movil ? 300 : 620);
  const nieve = new Float32Array(N_NIEVE * 4);
  for (let i = 0; i < N_NIEVE; i++) {
    nieve[i * 4] = (Math.random() - 0.5) * 30; nieve[i * 4 + 1] = Math.random() * 26;
    nieve[i * 4 + 2] = -22 + Math.random() * 31; nieve[i * 4 + 3] = Math.random();
  }
  const bufNieve = buf(nieve);

  // medusa: campana torneada + listones como tentáculos
  const medusa = (() => {
    const pos = [], nor = [], aux = [];
    const perfil = [];
    for (let j = 0; j <= 9; j++) { const a = (Math.PI / 2) * (1 - j / 9); perfil.push([Math.cos(a) * 0.5, Math.sin(a) * 0.42]); }
    perfil.push([0.44, -0.05]);
    const m = new Malla().agrega(torno(perfil, 22), [1, 1, 1]);
    for (let i = 0; i < m.pos.length; i += 3) { pos.push(m.pos[i], m.pos[i + 1], m.pos[i + 2]); nor.push(m.nor[i], m.nor[i + 1], m.nor[i + 2]); aux.push(-1, 0); }
    const TENT = 8, SEG = 12;
    for (let k = 0; k < TENT; k++) {
      const a = k / TENT * TAU, r = 0.30 + 0.1 * (k % 2), bx = Math.cos(a) * r, bz = Math.sin(a) * r, largo = 1.5 + 0.7 * ((k * 7) % 3) / 2, an = 0.022;
      for (let s = 0; s < SEG; s++) {
        const t0 = s / SEG, t1 = (s + 1) / SEG, y0 = -t0 * largo, y1 = -t1 * largo, f = k / TENT;
        const q = [[bx - an, y0, bz, t0], [bx + an, y0, bz, t0], [bx - an, y1, bz, t1], [bx + an, y0, bz, t0], [bx + an, y1, bz, t1], [bx - an, y1, bz, t1]];
        q.forEach(([x, y, z, t]) => { pos.push(x, y, z); nor.push(0, 0, 1); aux.push(t, f); });
      }
    }
    return { pos: buf(new Float32Array(pos)), nor: buf(new Float32Array(nor)), aux: buf(new Float32Array(aux)), n: pos.length / 3 };
  })();

  /* ---- estado ---- */
  let ancho = 0, alto = 0, dpr = 1, docAlto = 1, proy = M4.ident();
  let camX = 0, camY = 0, metaX = 0, metaY = 0, desvX = 0, desvY = 0;
  let prof = 0, t = 0, ultimo = 0, scrollAnt = window.scrollY, velScroll = 0;
  let pausado = false, vivo = true, alfaAgua = 1, lentos = 0, medidos = 0, ahorro = false, salto = false;
  const reliquias = (op.reliquias || []).filter((r) => RELIQUIAS[r.tipo]).map((r, i) => ({
    el: r.el, tipo: r.tipo, def: RELIQUIAS[r.tipo], giro: RELIQUIAS[r.tipo].modo === 'mece' ? 0 : i * 1.3, vel: 0, semilla: i * 2.17, arrastra: false, tumba: 0,
  }));

  // burbujas: una alberca fija que se reutiliza
  const MAX_B = 90, burbujas = [], datosB = new Float32Array(MAX_B * 4), alfaB = new Float32Array(MAX_B);
  const bufB = gl.createBuffer(), bufBA = gl.createBuffer();

  // fotos a la deriva: unas cuantas imágenes por visita (tope de datos), repartidas a lo largo de toda la bajada
  const fotos = [];
  const texturas = [];
  const listaFotos = (op.fotos && op.fotos.lista ? op.fotos.lista.slice() : []).sort(() => Math.random() - 0.5).slice(0, reducir ? 0 : (movil ? 9 : 16));
  function texturaDe(i) {
    if (texturas[i]) return texturas[i];
    const tx = { tex: null, lista: false };
    texturas[i] = tx;
    const img = new Image();
    img.onload = () => {
      if (!vivo) return;
      tx.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tx.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      tx.lista = true; tx.nace = t;
    };
    img.src = op.fotos.base + listaFotos[i];
    return tx;
  }

  const medusas = [], linternas = [];
  let yFondo = -100, yMedusas = [0, -10];

  function mide() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    const tope = movil ? 1.75 : 1.5;
    const d = Math.min(window.devicePixelRatio || 1, tope) * escalaCalidad;
    if (w !== ancho || h !== alto || d !== dpr) {
      ancho = w; alto = h; dpr = d;
      canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      proy = M4.persp(FOV, w / h, 0.5, 140);
    }
    const nuevoDoc = Math.max(document.documentElement.scrollHeight, h + 1);
    if (Math.abs(nuevoDoc - docAlto) > 2) { docAlto = nuevoDoc; reparte(); }
  }
  let escalaCalidad = 1;

  // reparte fotos y medusas a lo largo de toda la bajada (se rehace si cambia el alto de la página)
  function reparte() {
    const bajada = (docAlto - alto) / alto * HV;            // unidades de mundo de la superficie al fondo
    yFondo = -bajada - 3.3;
    const mitad = (ancho / alto) * HV * 0.5;
    fotos.length = 0;
    if (listaFotos.length) {
      const cuantas = Math.max(4, Math.round(bajada / (movil ? 4.2 : 3.0)));
      for (let i = 0; i < cuantas; i++) {
        const z = -4 - Math.random() * 15, alcance = mitad * (DIST - z) / DIST;
        fotos.push({
          img: i % listaFotos.length, x: (Math.random() * 2 - 1) * alcance * 0.95, y: 1.5 - (i + Math.random() * 0.8) / cuantas * (bajada + 4), z,
          esc: 0.75 + Math.random() * 0.7, rz: (Math.random() - 0.5) * 0.9, s: Math.random() * 100,
        });
      }
    }
    medusas.length = 0;
    yMedusas = [-bajada * 0.22, -bajada * 0.93];
    const nm = reducir ? 0 : (movil ? 4 : 7);
    for (let i = 0; i < nm; i++) {
      const z = -2.5 - Math.random() * 11, alcance = mitad * (DIST - z) / DIST;
      medusas.push({
        x: (Math.random() * 2 - 1) * alcance * 0.9, y: yMedusas[0] + (yMedusas[1] - yMedusas[0]) * (i + Math.random()) / nm, z,
        esc: 0.55 + Math.random() * 0.75, fase: Math.random() * TAU, vx: 0, vy: 0, tono: Math.random(),
      });
    }
    // linternas: solo en la mitad honda de la bajada
    linternas.length = 0;
    const nl = reducir ? 0 : (movil ? 2 : 3);
    for (let i = 0; i < nl; i++) {
      const z = -5 - Math.random() * 9;
      linternas.push({ y0: -bajada * (0.50 + 0.44 * (i + Math.random() * 0.6) / nl), z, ancho: mitad * (DIST - z) / DIST, s: Math.random() * 100, hx: 0, hy: 0, x: 0, y: 0 });
    }
  }

  // px de pantalla → mundo, en el plano z = 0
  const aMundo = (px, py) => [camX + (px - ancho / 2) / alto * HV, camY - (py - alto / 2) / alto * HV];

  function soplaBurbujas(px, py, n) {
    const [x, y] = aMundo(px, py);
    for (let i = 0; i < n && burbujas.length < MAX_B; i++) {
      burbujas.push({
        x: x + (Math.random() - 0.5) * 0.5, y: y + (Math.random() - 0.5) * 0.3, z: (Math.random() - 0.5) * 1.2,
        r: 0.05 + Math.random() * 0.16, vy: 0.7 + Math.random() * 1.5, s: Math.random() * 10, vida: 0, dura: 2.2 + Math.random() * 2.2,
      });
    }
    // las medusas cercanas se apartan del toque
    medusas.forEach((m) => {
      const k = DIST / (DIST - m.z), sx = camX + (m.x - camX) * k, sy = camY + (m.y - camY) * k, d = Math.hypot(sx - x, sy - y);
      if (d < 2.2) { m.vx += (sx - x) / (d + 0.2) * 0.9; m.vy += (sy - y) / (d + 0.2) * 0.9; }
    });
    linternas.forEach((l) => {
      const k = DIST / (DIST - l.z), sx = camX + (l.x - camX) * k, sy = camY + (l.y - camY) * k, d = Math.hypot(sx - x, sy - y);
      if (d < 2.6) { l.hx += (sx - x) / (d + 0.2) * 3.2; l.hy += (sy - y) / (d + 0.2) * 3.2; }
    });
  }

  /* ---- interacción con las reliquias: arrastrar para girarlas, tocar para empujarlas ---- */
  const limpiezas = [];
  const oye = (el, ev, fn, opc) => { el.addEventListener(ev, fn, opc); limpiezas.push(() => el.removeEventListener(ev, fn, opc)); };
  reliquias.forEach((r) => {
    let x0 = 0, xAnt = 0, tAnt = 0, movio = 0;
    oye(r.el, 'pointerdown', (e) => {
      r.arrastra = true; x0 = xAnt = e.clientX; tAnt = performance.now(); movio = 0;
      try { r.el.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
    });
    oye(r.el, 'pointermove', (e) => {
      if (!r.arrastra) return;
      const dx = e.clientX - xAnt, ahora = performance.now(), dt = Math.max(8, ahora - tAnt) / 1000;
      r.giro += dx * 0.012; r.vel = (dx * 0.012) / dt; movio += Math.abs(dx); xAnt = e.clientX; tAnt = ahora;
    });
    const suelta = (e) => {
      if (!r.arrastra) return;
      r.arrastra = false;
      if (movio < 6) { r.vel += 7 * (e.clientX < r.el.getBoundingClientRect().left + r.el.offsetWidth / 2 ? -1 : 1); soplaBurbujas(e.clientX, e.clientY, 9); if (op.alTocar) op.alTocar(r.tipo); }
      r.vel = Math.max(-22, Math.min(22, r.vel));
    };
    oye(r.el, 'pointerup', suelta); oye(r.el, 'pointercancel', () => { r.arrastra = false; });
  });
  if (!reducir) {
    oye(window, 'pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      metaX = (e.clientX / Math.max(1, ancho) - 0.5) * 0.9; metaY = -(e.clientY / Math.max(1, alto) - 0.5) * 0.5;
    }, { passive: true });
  }

  /* ---- dibujo ---- */
  function atributo(prog, nombre, buffer, tam) {
    const loc = prog.a[nombre];
    if (loc === undefined || loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, tam, gl.FLOAT, false, 0, 0);
  }
  function usaObj(vp) {
    const o = P.obj;
    gl.useProgram(o.p);
    gl.uniformMatrix4fv(o.u.uVP, false, vp); gl.uniform3f(o.u.uCam, camX, camY, DIST);
    gl.uniform1f(o.u.uT, t); gl.uniform1f(o.u.uProf, prof);
    return o;
  }
  function pinta(o, malla, M, m) {
    atributo(o, 'aPos', malla.pos, 3); atributo(o, 'aNor', malla.nor, 3); atributo(o, 'aCol', malla.col, 4);
    gl.uniformMatrix4fv(o.u.uM, false, M);
    gl.uniform1f(o.u.uMetal, m.metal || 0); gl.uniform1f(o.u.uIrid, m.irid || 0); gl.uniform1f(o.u.uRim, m.rim || 0);
    gl.uniform1f(o.u.uCalido, m.calido || 0); gl.uniform1f(o.u.uSolMin, m.solMin === undefined ? 0.3 : m.solMin);
    gl.uniform1f(o.u.uAlfa, m.alfa === undefined ? 1 : m.alfa); gl.uniform1f(o.u.uVidrio, m.vidrio || 0);
    gl.uniform1f(o.u.uNiebla, m.niebla === undefined ? 0.085 : m.niebla);
    const e = m.emis || [0, 0, 0]; gl.uniform3f(o.u.uEmis, e[0], e[1], e[2]);
    gl.drawArrays(gl.TRIANGLES, 0, malla.n);
  }

  function cuadroAnim(ahora) {
    if (!vivo) return;
    requestAnimationFrame(cuadroAnim);
    if (pausado || document.hidden) { ultimo = ahora; return; }
    let dt = Math.min(0.05, (ahora - ultimo) / 1000 || 0.016); ultimo = ahora;
    // si el teléfono no da: primero baja la resolución poco a poco; si ni así, dibuja un cuadro sí y uno no
    if (dt > 0.03) lentos++;
    if (++medidos >= 90) {
      if (lentos > 40) { if (escalaCalidad > 0.6) escalaCalidad -= 0.15; else ahorro = true; }
      lentos = 0; medidos = 0;
    }
    if (ahorro && (salto = !salto)) return;
    const paso = reducir ? dt * 0.2 : dt;
    t += paso;
    mide();

    const sy = window.scrollY || window.pageYOffset || 0;
    velScroll = velScroll * 0.85 + (sy - scrollAnt) * 0.15; scrollAnt = sy;
    prof = Math.min(1, Math.max(0, sy / Math.max(1, docAlto - alto)));
    desvX += (metaX - desvX) * Math.min(1, dt * 2.5); desvY += (metaY - desvY) * Math.min(1, dt * 2.5);
    const deriva = reducir ? 0 : 1;
    camX = desvX + Math.sin(t * 0.13) * 0.22 * deriva;
    camY = -(sy / alto) * HV + desvY + Math.sin(t * 0.17 + 1) * 0.12 * deriva;
    const vp = M4.mul(proy, M4.tras(-camX, -camY, -DIST));
    const px = canvas.height * proy[5];

    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // 1) el agua
    gl.useProgram(P.fondo.p);
    atributo(P.fondo, 'aPos', triFondo, 2);
    gl.uniform2f(P.fondo.u.uRes, canvas.width, canvas.height); gl.uniform1f(P.fondo.u.uT, t);
    gl.uniform1f(P.fondo.u.uProf, prof); gl.uniform1f(P.fondo.u.uAlfa, alfaAgua);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    const o = usaObj(vp);

    // 2) el desierto hundido (solo cerca del final)
    if (camY - yFondo < 14) pinta(o, mallas.fondo, M4.tras(0, yFondo, 0), { rim: 0.75, calido: 0.3, solMin: 0.55, niebla: 0.06 });

    // 4) reliquias, cada una sobre su hueco del HTML
    let hayBotella = null;
    reliquias.forEach((r) => {
      const d = r.def;
      if (!r.arrastra) {
        r.giro += ((d.modo === 'mece' ? 0 : d.vuelta) + r.vel) * paso;
        r.vel *= Math.pow(0.12, dt);                                  // el giro se va frenando, como en el agua
        if (!reducir) r.vel += velScroll * 0.0009;
      }
      if (d.modo === 'tumba') r.tumba += (0.35 + Math.abs(r.vel) * 0.3) * paso;
      const c = r.el.getBoundingClientRect();
      if (c.bottom < -alto * 0.25 || c.top > alto * 1.25 || c.width === 0) return;
      const [wx, wy] = aMundo(c.left + c.width / 2, c.top + c.height / 2);
      const esc = Math.min(c.width, c.height) / alto * HV * 0.5 * 0.9;
      const flota = Math.sin(t * 0.7 + r.semilla) * 0.07 * esc;
      const rx = M4.rotX(d.base[0] + Math.sin(t * 0.5 + r.semilla) * d.mece + (d.modo === 'tumba' ? r.tumba : 0));
      const rz = M4.rotZ(d.base[2] + Math.cos(t * 0.37 + r.semilla) * d.mece * 0.6);
      const vaiven = d.modo === 'mece' ? Math.sin(t * d.vuelta + r.semilla) * 0.8 : 0;
      const M = d.modo === 'trompo'
        ? M4.encadena(M4.tras(wx, wy + flota, 0), rx, rz, M4.rotY(r.giro), M4.esc(esc))
        : M4.encadena(M4.tras(wx, wy + flota, 0), M4.rotY(r.giro + vaiven), rx, rz, M4.esc(esc));
      pinta(o, mallas[r.tipo], M, d);
      if (r.tipo === 'botella') hayBotella = M;
    });

    // 3) fotos a la deriva
    if (fotos.length) {
      const f = P.foto;
      gl.useProgram(f.p);
      atributo(f, 'aPos', cuadro, 2);
      gl.uniformMatrix4fv(f.u.uVP, false, vp); gl.uniform3f(f.u.uCam, camX, camY, DIST);
      gl.uniform1f(f.u.uProf, prof); gl.uniform1f(f.u.uNiebla, 0.085); gl.uniform1i(f.u.uTex, 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0);
      fotos.forEach((ft) => {
        const alcance = (HV * 0.5) * (DIST - ft.z) / DIST + 2.5;
        if (Math.abs(ft.y - camY) > alcance) return;
        const tx = texturaDe(ft.img);
        if (!tx.lista) return;
        const y = ft.y + Math.sin(t * 0.21 + ft.s) * 0.35, x = ft.x + Math.sin(t * 0.13 + ft.s * 2) * 0.3;
        const M = M4.encadena(M4.tras(x, y, ft.z), M4.rotZ(ft.rz + Math.sin(t * 0.17 + ft.s) * 0.18),
          M4.rotY(Math.sin(t * 0.23 + ft.s * 3) * 0.55), M4.rotX(Math.cos(t * 0.19 + ft.s) * 0.35), M4.esc(ft.esc));
        gl.bindTexture(gl.TEXTURE_2D, tx.tex);
        gl.uniformMatrix4fv(f.u.uM, false, M); gl.uniform1f(f.u.uAlfa, Math.min(1, (t - tx.nace) * 0.6));
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      });
    }

    // de aquí en adelante todo es translúcido: no escribe profundidad
    gl.enable(gl.BLEND); gl.depthMask(false);

    if (hayBotella) {       // el vidrio de la botella, encima de su mensaje
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      pinta(usaObj(vp), mallas.botellaVidrio, hayBotella, { rim: 1.1, calido: 0.6, alfa: 0.16, vidrio: 1, metal: 0.35 });
    }

    // 5) medusas (luz propia: se suman al fondo)
    if (medusas.length) {
      const md = P.medusa;
      gl.useProgram(md.p); gl.blendFunc(gl.ONE, gl.ONE);
      atributo(md, 'aPos', medusa.pos, 3); atributo(md, 'aNor', medusa.nor, 3); atributo(md, 'aAux', medusa.aux, 2);
      gl.uniformMatrix4fv(md.u.uVP, false, vp); gl.uniform3f(md.u.uCam, camX, camY, DIST); gl.uniform1f(md.u.uT, t);
      const largo = yMedusas[0] - yMedusas[1];
      medusas.forEach((m) => {
        const pulso = Math.max(0, Math.sin(t * 1.5 + m.fase));
        m.y += (0.10 + 0.32 * pulso) * paso + m.vy * dt; m.x += (Math.sin(t * 0.2 + m.fase) * 0.12) * paso + m.vx * dt;
        m.vx *= Math.pow(0.2, dt); m.vy *= Math.pow(0.2, dt);
        if (m.y > yMedusas[0] + 2) m.y -= largo + 2;
        const alcance = (HV * 0.5) * (DIST - m.z) / DIST + 4;
        if (Math.abs(m.y - camY) > alcance) return;
        gl.uniform3f(md.u.uPosM, m.x, m.y, m.z); gl.uniform1f(md.u.uEsc, m.esc); gl.uniform1f(md.u.uFase, m.fase);
        const c = m.tono < 0.75 ? [0.30, 0.95, 0.88] : [0.62, 0.55, 1.0];
        gl.uniform3f(md.u.uColor, c[0], c[1], c[2]); gl.uniform1f(md.u.uBrillo, 0.5 + 0.2 * pulso);
        gl.drawArrays(gl.TRIANGLES, 0, medusa.n);
      });
    }

    // linternas
    if (linternas.length) {
      const lz = P.luz;
      gl.useProgram(lz.p); gl.blendFunc(gl.ONE, gl.ONE);
      atributo(lz, 'aPos', cuadro, 2);
      gl.uniformMatrix4fv(lz.u.uVP, false, vp);
      linternas.forEach((l) => {
        l.hx *= Math.pow(0.35, dt); l.hy *= Math.pow(0.35, dt);
        l.x = Math.sin(t * 0.061 + l.s) * l.ancho * 0.75 + Math.sin(t * 0.23 + l.s * 3) * 0.5 + l.hx;
        l.y = l.y0 + Math.sin(t * 0.047 + l.s * 2) * 2.4 + l.hy;
        if (Math.abs(l.y - camY) > (HV * 0.5) * (DIST - l.z) / DIST + 3) return;
        const late = 0.55 + 0.45 * Math.sin(t * 0.9 + l.s) * Math.sin(t * 0.31 + l.s * 5);
        gl.uniform3f(lz.u.uCentro, l.x, l.y, l.z); gl.uniform1f(lz.u.uTam, 1.5);
        gl.uniform1f(lz.u.uBrillo, late * Math.exp(-(-l.z) * 0.045));
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      });
    }

    // nieve marina
    gl.useProgram(P.nieve.p); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    atributo(P.nieve, 'aP', bufNieve, 4);
    gl.uniformMatrix4fv(P.nieve.u.uVP, false, vp); gl.uniform1f(P.nieve.u.uT, t); gl.uniform1f(P.nieve.u.uCamY, camY);
    gl.uniform1f(P.nieve.u.uPx, px); gl.uniform1f(P.nieve.u.uProf, prof);
    gl.drawArrays(gl.POINTS, 0, N_NIEVE);

    // burbujas
    if (!reducir && Math.random() < dt * 0.5 && burbujas.length < MAX_B - 12) soplaBurbujas(Math.random() * ancho, alto * (0.75 + Math.random() * 0.4), 1 + Math.floor(Math.random() * 3));
    let nb = 0;
    for (let i = burbujas.length - 1; i >= 0; i--) {
      const b = burbujas[i];
      b.vida += dt; b.y += b.vy * dt; b.x += Math.sin(b.vida * 5 + b.s) * 0.35 * dt;
      if (b.vida > b.dura) { burbujas.splice(i, 1); continue; }
      datosB[nb * 4] = b.x; datosB[nb * 4 + 1] = b.y; datosB[nb * 4 + 2] = b.z; datosB[nb * 4 + 3] = b.r;
      alfaB[nb] = Math.min(1, b.vida * 6) * Math.min(1, (b.dura - b.vida) * 1.5); nb++;
    }
    if (nb) {
      const pb = P.burbuja;
      gl.useProgram(pb.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufB); gl.bufferData(gl.ARRAY_BUFFER, datosB.subarray(0, nb * 4), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(pb.a.aP); gl.vertexAttribPointer(pb.a.aP, 4, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufBA); gl.bufferData(gl.ARRAY_BUFFER, alfaB.subarray(0, nb), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(pb.a.aA); gl.vertexAttribPointer(pb.a.aA, 1, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(pb.u.uVP, false, vp); gl.uniform1f(pb.u.uPx, px);
      gl.drawArrays(gl.POINTS, 0, nb);
    }
    gl.depthMask(true);

    if (op.alCuadro) op.alCuadro(prof, t);
    if (!pinto) { pinto = true; if (op.alEmpezar) op.alEmpezar(); }
  }
  let pinto = false;

  oye(canvas, 'webglcontextlost', (e) => { e.preventDefault(); pausado = true; });
  mide(); reparte();
  requestAnimationFrame((a) => { ultimo = a; cuadroAnim(a); });

  return {
    burbujas: soplaBurbujas,
    pausa(si) { pausado = !!si; },
    agua(alfa) { alfaAgua = alfa; },          // < 1 deja ver lo que haya detrás del canvas (el modo espejo)
    destruye() { vivo = false; limpiezas.forEach((f) => f()); },
  };
}
