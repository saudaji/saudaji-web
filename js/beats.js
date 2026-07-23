/* BEATS v3 — secuenciador estilo KORG M01 montado sobre el motor DS-10 (v2).
   Qué hace este archivo: estación de música completa para el hub de juegos —
   hasta 8 tracks multitimbrales (drum kit + banco de patches sintetizados),
   editor de patrones (grid de drums y piano-roll táctil, 16/32/64 steps),
   song mode de 32 compases, mixer (vol/pan/mute/solo), FX globales con bypass,
   pad Kaoss XY y persistencia/export JSON. El timing usa lookahead scheduling
   (timer de 25ms agenda ~100ms de futuro con start(t) exacto — jamás dispares
   audio "cuando despierta el timer", suena tambaleante).
   Se carga lazy desde index.html con init(container)/destroy(). */

/* ===== valores ajustables — edita aquí, no en la lógica ===== */
const AUDIO_DIR = 'assets/audio/';         // convención en assets/audio/README.md
const DRUM_NAMES = ['kick', 'snare', 'hihat', 'clap', 'tom', 'crash'];
const SAMPLE_KEYS = ['piano', 'rhodes'];   // WAV opcionales, afinados en C4
const SAMPLE_ROOT_HZ = 261.63;
const MAX_TRACKS = 8;
const NUM_PATTERNS = 8;                    // patrones 1-8 (el song los encadena)
const PATTERN_LENGTHS = [16, 32, 64];      // steps permitidos por patrón
const SONG_BARS = 32;                      // casillas del song mode
const NOTE_RANGE = 25;                     // semitonos del piano-roll (2 octavas + 1)
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.1;
const DELAY_FEEDBACK_MAX = 0.85;           // clamp duro contra loops de volumen
const LS_KEY = 'games.beats.song';
/* ============================================================ */

/* ---- banco de instrumentos ----
   'drumkit' usa el grid de batería; el resto son patches del motor DS-10:
   mode MIX = subtractivo (OSC2 se suma antes del filtro) · FM = OSC2 modula la
   frecuencia de OSC1 (imprescindible para timbres tipo DX7/M1, si los fuerzas
   a MIX suenan a campana genérica). Piano/Rhodes usan WAV si existe; sus
   fallbacks sintetizados son DELIBERADAMENTE distintos entre sí. */
const PATCHES = {
  acid:    { cat: 'bajo', nombre: 'Acid 303', mode: 'MIX', oct: -1, o1: 'square', o2: 'sawtooth', o2vol: 0, o2semi: 0, detune: 0, cutoff: 500, res: 16, fEnvAmt: 2600, adsr: [0.003, 0.16, 0, 0.08], slide: 0.09, dist: 0.25 },
  moog:    { cat: 'bajo', nombre: 'Moog', mode: 'MIX', oct: -1, o1: 'sawtooth', o2: 'sawtooth', o2vol: 0.55, o2semi: -12, detune: 9, cutoff: 750, res: 5, fEnvAmt: 900, adsr: [0.008, 0.22, 0.35, 0.15] },
  loco:    { cat: 'bajo', nombre: 'Loco', mode: 'MIX', oct: -1, ring: true, o1: 'sawtooth', o2: 'square', o2vol: 0.8, o2semi: 7, detune: 25, cutoff: 1200, res: 22, fEnvAmt: 400, wobble: 6, adsr: [0.01, 0.3, 0.5, 0.2], dist: 0.5 },
  dx7:     { cat: 'ep', nombre: 'DX7 E.Piano', mode: 'FM', oct: 0, o1: 'sine', o2: 'sine', fmRatio: 14, fmIndex: 900, fmDecay: 0.12, cutoff: 6000, res: 0.5, fEnvAmt: 0, adsr: [0.004, 0.9, 0, 0.25] },
  piano:   { cat: 'piano', nombre: 'Piano', mode: 'FM', oct: 0, sample: 'piano', o1: 'triangle', o2: 'sine', fmRatio: 3.01, fmIndex: 420, fmDecay: 0.05, brillo: true, cutoff: 7500, res: 0.5, fEnvAmt: 0, adsr: [0.002, 0.55, 0, 0.12] },
  rhodes:  { cat: 'ep', nombre: 'Rhodes', mode: 'FM', oct: 0, sample: 'rhodes', o1: 'sine', o2: 'sine', fmRatio: 8, fmIndex: 160, fmDecay: 0.1, trem: 5, cutoff: 3500, res: 0.5, fEnvAmt: 0, adsr: [0.006, 1.1, 0.15, 0.35] },
  m1piano: { cat: 'piano', nombre: 'M1 Piano', mode: 'MIX', oct: 0, o1: 'triangle', o2: 'sine', o2vol: 0.35, o2semi: 19, detune: 6, cutoff: 7000, res: 1, fEnvAmt: 1200, adsr: [0.002, 0.4, 0.1, 0.15] },
  organ:   { cat: 'teclas', nombre: 'Órgano', mode: 'MIX', oct: 0, o1: 'sine', o2: 'sine', o2vol: 0.6, o2semi: 12, detune: 0, cutoff: 6000, res: 0.5, fEnvAmt: 0, adsr: [0.01, 0.05, 1, 0.08] },
  pad:     { cat: 'pad', nombre: 'Pad', mode: 'MIX', oct: 0, o1: 'sawtooth', o2: 'sawtooth', o2vol: 0.6, o2semi: 0, detune: 12, cutoff: 1200, res: 2, fEnvAmt: 500, adsr: [0.35, 0.4, 0.8, 0.8] },
  lead:    { cat: 'lead', nombre: 'Lead', mode: 'MIX', oct: 0, o1: 'square', o2: 'sawtooth', o2vol: 0.5, o2semi: 0, detune: 7, cutoff: 3000, res: 4, fEnvAmt: 800, adsr: [0.01, 0.15, 0.7, 0.2] },
  bell:    { cat: 'fx', nombre: 'Campana', mode: 'FM', oct: 1, o1: 'sine', o2: 'sine', fmRatio: 3.53, fmIndex: 600, fmDecay: 0.4, cutoff: 9000, res: 0.5, fEnvAmt: 0, adsr: [0.002, 1.4, 0, 0.6] }
};

// ---- estado global del módulo ----
let ctx = null, buffers = { drums: {}, keys: {} };
let root = null, timer = null, raf = null;
let playing = false, loop = true, modo = 'patron';   // 'patron' | 'cancion'
let patronActual = 0, trackActual = 0, tab = 'patron';
let nextTime = 0, step = 0, bar = 0, drawQueue = [], clipboard = null;
let nodos = null, trackNodes = [];                    // cadenas de mixer por track
let onKeyDown, onKeyUp, onVis;
let proyecto = null;                                  // TODO el estado persistible
let ultimaFreq = null, rollOctava = 0;

// ---- proyecto: crear / migrar / guardar ----
function trackNuevo(inst) {
  return { inst, vol: 0.8, pan: 0, mute: false, solo: false, params: patchCopia(inst) };
}
function patchCopia(inst) {
  if (inst === 'drumkit') return null;
  const p = Object.assign({}, PATCHES[inst]);
  p.adsr = PATCHES[inst].adsr.slice();
  return p;
}
function patronNuevo() { return { len: 16, data: {} }; } // data[trackIdx] se crea al editar
function celdasDe(pat, tIdx) {
  const t = proyecto.tracks[tIdx];
  if (!pat.data[tIdx]) {
    pat.data[tIdx] = t.inst === 'drumkit'
      ? DRUM_NAMES.map(() => Array(pat.len).fill(false))
      : [];                                            // melódico: [{s, semi}]
  }
  return pat.data[tIdx];
}
function proyectoNuevo() {
  proyecto = {
    v: 3, bpm: 110, swing: 0, metronomo: false,
    fx: { delayTime: 0.25, delayFb: 0.3, dist: 0, revMix: 0.15, revOn: true, delOn: true },
    tracks: [trackNuevo('drumkit'), trackNuevo('acid'), trackNuevo('dx7'), trackNuevo('m1piano')],
    patterns: Array.from({ length: NUM_PATTERNS }, patronNuevo),
    song: Array(SONG_BARS).fill(-1)
  };
  proyecto.song[0] = 0;
}
function guardar() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(proyecto)); } catch (e) {}
}
function cargar() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if (s && s.v === 3 && s.tracks) { proyecto = s; reconstruirParams(); return; }
    if (s && s.patterns) { migrarV2(s); return; }      // formato v2 (drum machine DS-10)
  } catch (e) {}
  proyectoNuevo();
}
function reconstruirParams() {
  // los params guardados pueden venir de versiones con menos campos
  proyecto.tracks.forEach(t => {
    if (t.inst !== 'drumkit') t.params = Object.assign(patchCopia(t.inst), t.params);
  });
}
function migrarV2(s) {
  proyectoNuevo();
  proyecto.bpm = s.bpm || 110;
  if (s.fx) Object.assign(proyecto.fx, s.fx);
  s.patterns.slice(0, NUM_PATTERNS).forEach((p, i) => {
    const drums = Array.isArray(p) ? p : p.drums;
    const synth = Array.isArray(p) ? [] : (p.synth || []);
    if (drums) proyecto.patterns[i].data[0] = drums.map(f => f.slice(0, 16));
    if (synth.length) proyecto.patterns[i].data[2] = synth.map(n => ({ s: n.s, semi: n.semi }));
  });
  if (s.arrangement) proyecto.song = s.arrangement.map(x => (x >= 0 && x < NUM_PATTERNS) ? x : -1);
  console.info('[beats] proyecto migrado de v2 a v3 (M01)');
}

// ---- audio base ----
function asegurarCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    armarFx();
    armarMixer();
    cargarSamples();
  }
  if (ctx.state === 'suspended') ctx.resume(); // iOS: suspended hasta el primer gesto
}
function armarFx() {
  // buses globales: master seco + envíos a delay y reverb (con bypass)
  const master = ctx.createGain();
  const delay = ctx.createDelay(1);
  const fbGain = ctx.createGain();
  const delayWet = ctx.createGain();
  const conv = ctx.createConvolver();
  const revWet = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  conv.buffer = impulso(1.2);
  master.connect(shaper);
  shaper.connect(ctx.destination);
  master.connect(delay); delay.connect(fbGain); fbGain.connect(delay);
  delay.connect(delayWet); delayWet.connect(ctx.destination);
  master.connect(conv); conv.connect(revWet); revWet.connect(ctx.destination);
  nodos = { master, shaper, delay, fbGain, delayWet, conv, revWet };
  aplicarFx();
}
function aplicarFx() {
  if (!nodos) return;
  const f = proyecto.fx;
  nodos.delay.delayTime.value = f.delayTime;
  nodos.fbGain.gain.value = Math.min(f.delayFb, DELAY_FEEDBACK_MAX);
  nodos.delayWet.gain.value = f.delOn && f.delayTime > 0 ? 0.5 : 0;   // bypass = wet a 0
  nodos.revWet.gain.value = f.revOn ? f.revMix : 0;
  nodos.shaper.curve = curvaDist(f.dist);
}
function armarMixer() {
  // una cadena gain→panner por track, todas al master
  trackNodes = proyecto.tracks.map(() => null);
  proyecto.tracks.forEach((t, i) => asegurarTrackNodes(i));
}
function asegurarTrackNodes(i) {
  if (!ctx) return null;
  if (!trackNodes[i]) {
    const g = ctx.createGain();
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    g.connect(pan); pan.connect(nodos.master);
    trackNodes[i] = { g, pan };
  }
  aplicarMixerTrack(i);
  return trackNodes[i];
}
function haySolo() { return proyecto.tracks.some(t => t.solo); }
function aplicarMixerTrack(i) {
  const t = proyecto.tracks[i], n = trackNodes[i];
  if (!n) return;
  const audible = !t.mute && (!haySolo() || t.solo);
  n.g.gain.value = audible ? t.vol : 0;
  if (n.pan.pan) n.pan.pan.value = t.pan;
}
function curvaDist(cantidad) {
  const n = 256, curva = new Float32Array(n), k = cantidad * 50;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curva[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curva;
}
function impulso(dur) {
  const len = ctx.sampleRate * dur;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return buf;
}
function cargarSamples() {
  // archivos opcionales: si faltan, fallback sintetizado — nunca crash
  DRUM_NAMES.forEach(n => {
    fetch(AUDIO_DIR + 'drums/' + n + '.wav')
      .then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
      .then(b => ctx.decodeAudioData(b)).then(b => { buffers.drums[n] = b; })
      .catch(() => console.info('[beats] sin sample drums/' + n + '.wav — synth de respaldo'));
  });
  SAMPLE_KEYS.forEach(n => {
    fetch(AUDIO_DIR + 'keys/' + n + '.wav')
      .then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
      .then(b => ctx.decodeAudioData(b)).then(b => { buffers.keys[n] = b; })
      .catch(() => console.info('[beats] sin sample keys/' + n + '.wav — fallback sintetizado'));
  });
}

// ---- voces ----
function sonarDrum(nombre, t, salida) {
  const buf = buffers.drums[nombre];
  if (buf) {
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(salida); src.start(t);
    return;
  }
  const g = ctx.createGain();
  g.connect(salida);
  if (nombre === 'kick' || nombre === 'tom') {
    const [f0, f1, dur] = nombre === 'kick' ? [150, 40, 0.25] : [200, 90, 0.3];
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.5);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); o.start(t); o.stop(t + dur + 0.05);
  } else {
    const dur = { snare: 0.15, hihat: 0.05, clap: 0.12, crash: 0.7 }[nombre] || 0.1;
    const nb = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = nb;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = { snare: 1500, hihat: 7000, clap: 1200, crash: 4000 }[nombre] || 2000;
    g.gain.setValueAtTime(nombre === 'crash' ? 0.4 : 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); src.start(t);
  }
}

/* motor DS-10 por nota: OSC1(+OSC2) → filtro 24dB (2 lowpass en serie) → ADSR → track.
   MIX suma OSC2; FM conecta OSC2→osc1.frequency con SU envolvente de índice
   (ataque metálico → cuerpo); ring/wobble/trem son los extras de cada patch. */
function sonarNota(p, semitono, t, dur, salida) {
  dur = dur || 1.0;
  const freq = SAMPLE_ROOT_HZ * Math.pow(2, (semitono + (p.oct || 0) * 12) / 12);

  if (p.sample && buffers.keys[p.sample]) {
    const src = ctx.createBufferSource();
    src.buffer = buffers.keys[p.sample];
    src.playbackRate.value = Math.pow(2, semitono / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(dur, 1.5));
    src.connect(g); g.connect(salida);
    src.start(t);
    return;
  }

  const [A, D, S, R] = p.adsr;
  const fin = t + Math.max(dur, A + D) + R;

  const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
  f1.type = f2.type = 'lowpass';
  f1.Q.value = p.res; f2.Q.value = 0.5;
  f1.frequency.setValueAtTime(Math.min(p.cutoff + (p.fEnvAmt || 0), 18000), t);
  f1.frequency.exponentialRampToValueAtTime(Math.max(p.cutoff, 30), t + Math.max(D, 0.05));
  f2.frequency.value = Math.min(p.cutoff * 2 + (p.fEnvAmt || 0), 18000);

  let destinoOsc = f1;
  if (p.dist) {
    const sh = ctx.createWaveShaper();
    sh.curve = curvaDist(p.dist);
    sh.connect(f1);
    destinoOsc = sh;
  }

  const amp = ctx.createGain();
  f1.connect(f2); f2.connect(amp); amp.connect(salida);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.55, t + A);
  amp.gain.linearRampToValueAtTime(0.55 * S, t + A + D);
  amp.gain.setValueAtTime(0.55 * S, fin - R);
  amp.gain.linearRampToValueAtTime(0.0001, fin);

  const o1 = ctx.createOscillator();
  o1.type = p.o1;
  if (p.slide && ultimaFreq) {                     // portamento acid
    o1.frequency.setValueAtTime(ultimaFreq, t);
    o1.frequency.linearRampToValueAtTime(freq, t + p.slide);
  } else {
    o1.frequency.setValueAtTime(freq, t);
  }
  if (p.slide) ultimaFreq = freq;

  const osc = [o1];
  if (p.mode === 'FM') {
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * (p.fmRatio || 1);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(p.fmIndex || 0, t);
    mg.gain.exponentialRampToValueAtTime(Math.max((p.fmIndex || 0) * 0.06, 0.5), t + (p.fmDecay || 0.1));
    mod.connect(mg); mg.connect(o1.frequency);
    osc.push(mod);
    o1.connect(destinoOsc);
    if (p.brillo) {
      // "brillo": parcial agudo extra con decay rapidísimo — distingue al Piano
      // acústico-fallback del Rhodes (que en cambio lleva tremolo)
      const hi = ctx.createOscillator(), hg = ctx.createGain();
      hi.type = 'sine'; hi.frequency.value = freq * 4.2;
      hg.gain.setValueAtTime(0.12, t);
      hg.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      hi.connect(hg); hg.connect(salida);
      osc.push(hi);
    }
  } else {
    const o2 = ctx.createOscillator();
    o2.type = p.o2;
    o2.frequency.value = freq * Math.pow(2, (p.o2semi || 0) / 12);
    o2.detune.value = p.detune || 0;
    if (p.ring) {
      const rg = ctx.createGain(); rg.gain.value = 0;
      const prof = ctx.createGain(); prof.gain.value = p.o2vol;
      o2.connect(prof); prof.connect(rg.gain);
      o1.connect(rg); rg.connect(destinoOsc);
    } else {
      const g2 = ctx.createGain(); g2.gain.value = p.o2vol || 0;
      o2.connect(g2); g2.connect(destinoOsc);
      o1.connect(destinoOsc);
    }
    osc.push(o2);
  }
  if (p.wobble) {
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = p.wobble;
    lg.gain.value = p.cutoff * 0.6;
    lfo.connect(lg); lg.connect(f1.frequency);
    osc.push(lfo);
  }
  if (p.trem) {
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = p.trem;
    lg.gain.value = 0.18;
    lfo.connect(lg); lg.connect(amp.gain);
    osc.push(lfo);
  }
  osc.forEach(o => { try { o.start(t); } catch (e) {} try { o.stop(fin + 0.05); } catch (e) {} });
}

function tocarEnVivo(semitono) {
  asegurarCtx();
  const t = proyecto.tracks[trackActual];
  const salida = asegurarTrackNodes(trackActual).g;
  if (t.inst === 'drumkit') sonarDrum(DRUM_NAMES[Math.abs(semitono) % 6], ctx.currentTime, salida);
  else sonarNota(t.params, semitono + rollOctava * 12, ctx.currentTime, 0.9, salida);
}

// ---- transporte + scheduler lookahead ----
function patronDelCompas(b) {
  return modo === 'patron' ? patronActual : proyecto.song[b % SONG_BARS];
}
function dieciseisavo() { return 60 / proyecto.bpm / 4; }
function scheduler() {
  while (nextTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
    const pIdx = patronDelCompas(bar);
    const pat = pIdx >= 0 ? proyecto.patterns[pIdx] : null;
    // swing: los dieciseisavos impares se retrasan una fracción del step
    const tSwing = nextTime + (step % 2 === 1 ? proyecto.swing * dieciseisavo() * 0.5 : 0);
    if (pat) {
      proyecto.tracks.forEach((t, i) => {
        const celdas = pat.data[i];
        if (!celdas) return;
        const salida = asegurarTrackNodes(i).g;
        const s = step % pat.len;
        if (t.inst === 'drumkit') {
          DRUM_NAMES.forEach((n, fila) => { if (celdas[fila] && celdas[fila][s]) sonarDrum(n, tSwing, salida); });
        } else {
          celdas.forEach(nota => { if (nota.s === s) sonarNota(t.params, nota.semi, tSwing, dieciseisavo() * 2, salida); });
        }
      });
      if (proyecto.metronomo && step % 4 === 0) metronomoClick(nextTime, step === 0);
    }
    drawQueue.push({ time: nextTime, step, bar });
    nextTime += dieciseisavo();
    step++;
    const len = pat ? pat.len : 16;
    if (step >= len) {
      step = 0; bar++;
      const fin = modo === 'patron' || bar >= SONG_BARS;
      if (fin) {
        if (!loop) { pararDespues(); return; }
        bar = 0;
      }
    }
  }
}
function metronomoClick(t, acento) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = acento ? 1600 : 1100;
  g.gain.setValueAtTime(0.15, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  o.connect(g); g.connect(ctx.destination);
  o.start(t); o.stop(t + 0.05);
}
function pararDespues() {
  const espera = Math.max(0, (nextTime - ctx.currentTime) * 1000);
  clearInterval(timer); timer = null;
  setTimeout(() => { if (playing) stop(); }, espera);
}
function pintarIndicador() {
  let ev = null;
  while (drawQueue.length && drawQueue[0].time <= ctx.currentTime) ev = drawQueue.shift();
  if (ev && root) {
    root.querySelectorAll('.bt-celda.ahora, .roll-celda.ahora, .bt-compas.ahora').forEach(c => c.classList.remove('ahora'));
    const pIdx = patronDelCompas(ev.bar);
    if (pIdx === patronActual || modo === 'patron') {
      const pat = proyecto.patterns[patronActual];
      const s = ev.step % pat.len;
      root.querySelectorAll('[data-step="' + s + '"]').forEach(c => c.classList.add('ahora'));
    }
    if (modo === 'cancion') {
      const cel = root.querySelector('[data-compas="' + ev.bar + '"]');
      if (cel) cel.classList.add('ahora');
    }
  }
  raf = requestAnimationFrame(pintarIndicador);
}
function play() {
  asegurarCtx();
  if (playing) return;
  playing = true;
  step = 0; bar = 0; ultimaFreq = null;
  nextTime = ctx.currentTime + 0.06;
  timer = setInterval(scheduler, LOOKAHEAD_MS);
  raf = requestAnimationFrame(pintarIndicador);
  root.querySelector('.bt-play').textContent = '■ stop';
}
function stop() {
  playing = false;
  clearInterval(timer); timer = null;
  cancelAnimationFrame(raf); raf = null;
  drawQueue = [];
  if (root) {
    root.querySelectorAll('.ahora').forEach(c => c.classList.remove('ahora'));
    root.querySelector('.bt-play').textContent = '▶ play';
  }
}

// ============================== UI ==============================
function el(tag, cls, texto) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto !== undefined) e.textContent = texto;
  return e;
}
function btn(cls, texto, cb) {
  const b = el('button', 'bt-btn ' + (cls || ''), texto);
  b.addEventListener('click', cb);
  return b;
}

// --- pantalla superior: transporte + patrones + tracks ---
function renderTop() {
  const top = root.querySelector('.m01-top');
  top.innerHTML = '';

  const fila = el('div', 'bt-fila');
  const bPlay = btn('bt-play', playing ? '■ stop' : '▶ play', () => playing ? stop() : play());
  const bLoop = btn('bt-loop' + (loop ? ' activo' : ''), 'loop', () => { loop = !loop; bLoop.classList.toggle('activo', loop); });
  const bModo = btn('', modo === 'patron' ? 'modo: patrón' : 'modo: canción', () => {
    modo = modo === 'patron' ? 'cancion' : 'patron';
    bModo.textContent = 'modo: ' + (modo === 'patron' ? 'patrón' : 'canción');
  });
  const bMet = btn(proyecto.metronomo ? 'activo' : '', 'metro', () => {
    proyecto.metronomo = !proyecto.metronomo;
    bMet.classList.toggle('activo', proyecto.metronomo);
    guardar();
  });
  fila.append(bPlay, bLoop, bModo, bMet);

  const lBpm = el('label', '', 'bpm ');
  const iBpm = el('input');
  iBpm.type = 'number'; iBpm.min = 60; iBpm.max = 200; iBpm.value = proyecto.bpm;
  iBpm.className = 'bt-num';
  iBpm.addEventListener('change', () => { proyecto.bpm = Math.max(60, Math.min(200, +iBpm.value || 110)); guardar(); });
  lBpm.append(iBpm);
  const lSw = el('label', '', 'swing ');
  const iSw = el('input');
  iSw.type = 'range'; iSw.min = 0; iSw.max = 0.6; iSw.step = 0.01; iSw.value = proyecto.swing;
  iSw.style.width = '70px';
  iSw.addEventListener('input', () => { proyecto.swing = +iSw.value; guardar(); });
  lSw.append(iSw);
  fila.append(lBpm, lSw);
  top.append(fila);

  // selector de patrón 1-8 + operaciones
  const filaP = el('div', 'bt-fila');
  for (let p = 0; p < NUM_PATTERNS; p++) {
    filaP.append(btn(p === patronActual ? 'activo' : '', String(p + 1), () => {
      patronActual = p; renderTop(); renderBottom();
    }));
  }
  filaP.append(
    btn('', 'copiar', () => { clipboard = JSON.parse(JSON.stringify(proyecto.patterns[patronActual])); }),
    btn('', 'pegar', () => { if (clipboard) { proyecto.patterns[patronActual] = JSON.parse(JSON.stringify(clipboard)); guardar(); renderBottom(); } }),
    btn('', 'limpiar', () => { proyecto.patterns[patronActual] = patronNuevo(); guardar(); renderBottom(); })
  );
  // longitud del patrón
  const sel = el('select', 'bt-select');
  PATTERN_LENGTHS.forEach(l => {
    const o = el('option', '', l + ' steps');
    o.value = l; o.style.color = '#222';
    sel.append(o);
  });
  sel.value = proyecto.patterns[patronActual].len;
  sel.addEventListener('change', () => {
    const pat = proyecto.patterns[patronActual];
    const nueva = +sel.value;
    Object.keys(pat.data).forEach(k => {
      const t = proyecto.tracks[k];
      if (t && t.inst === 'drumkit') {
        pat.data[k] = pat.data[k].map(fila => {
          const f = fila.slice(0, nueva);
          while (f.length < nueva) f.push(false);
          return f;
        });
      } else if (pat.data[k]) {
        pat.data[k] = pat.data[k].filter(n => n.s < nueva);
      }
    });
    pat.len = nueva;
    guardar(); renderBottom();
  });
  filaP.append(sel);
  top.append(filaP);

  // tracks: selector + instrumento + agregar
  const filaT = el('div', 'bt-fila m01-tracks');
  proyecto.tracks.forEach((t, i) => {
    const b = btn(i === trackActual ? 'activo' : '', (i + 1) + '·' + (t.inst === 'drumkit' ? 'drums' : PATCHES[t.inst].nombre), () => {
      trackActual = i; renderTop(); renderBottom();
    });
    if (t.mute) b.style.opacity = 0.4;
    filaT.append(b);
  });
  if (proyecto.tracks.length < MAX_TRACKS) {
    filaT.append(btn('', '+ track', () => {
      proyecto.tracks.push(trackNuevo('lead'));
      trackNodes.push(null);
      trackActual = proyecto.tracks.length - 1;
      guardar(); renderTop(); renderBottom();
    }));
  }
  top.append(filaT);
}

// --- pantalla inferior: tabs patrón / mixer / kaoss / song ---
function renderBottom() {
  const tabs = root.querySelector('.m01-tabs');
  tabs.querySelectorAll('.bt-btn').forEach(b => b.classList.toggle('activo', b.dataset.tab === tab));
  const cuerpo = root.querySelector('.m01-cuerpo');
  cuerpo.innerHTML = '';
  if (tab === 'patron') renderEditor(cuerpo);
  else if (tab === 'mixer') renderMixer(cuerpo);
  else if (tab === 'kaoss') renderKaoss(cuerpo);
  else renderSong(cuerpo);
}

function renderEditor(cuerpo) {
  const t = proyecto.tracks[trackActual];
  const pat = proyecto.patterns[patronActual];
  const celdas = celdasDe(pat, trackActual);

  // selector de instrumento del track
  const filaI = el('div', 'bt-fila');
  const sel = el('select', 'bt-select');
  const oDr = el('option', '', 'drum kit'); oDr.value = 'drumkit'; oDr.style.color = '#222';
  sel.append(oDr);
  Object.entries(PATCHES).forEach(([id, p]) => {
    const o = el('option', '', p.cat + ': ' + p.nombre);
    o.value = id; o.style.color = '#222';
    sel.append(o);
  });
  sel.value = t.inst;
  sel.addEventListener('change', () => {
    t.inst = sel.value;
    t.params = patchCopia(sel.value);
    delete pat.data[trackActual];                    // el patrón viejo no aplica al nuevo tipo
    guardar(); renderTop(); renderBottom();
  });
  filaI.append(el('label', '', 'instrumento '), sel);
  cuerpo.append(filaI);

  if (t.inst === 'drumkit') {
    const wrap = el('div', 'bt-scroll');
    const grid = el('div', 'bt-grid');
    grid.style.gridTemplateColumns = '52px repeat(' + pat.len + ', minmax(14px, 1fr))';
    DRUM_NAMES.forEach((n, fila) => {
      grid.append(el('div', 'bt-nombre', n));
      for (let s = 0; s < pat.len; s++) {
        const c = el('button', 'bt-celda' + (celdas[fila][s] ? ' on' : ''));
        c.dataset.step = s;
        c.addEventListener('click', () => {
          celdas[fila][s] = !celdas[fila][s];
          c.classList.toggle('on');
          guardar();
        });
        grid.append(c);
      }
    });
    wrap.append(grid);
    cuerpo.append(wrap);
  } else {
    // piano-roll: NOTE_RANGE semitonos × len steps, toggle por celda táctil
    const filaO = el('div', 'bt-fila');
    filaO.append(
      btn('', 'oct −', () => { rollOctava = Math.max(-2, rollOctava - 1); renderBottom(); }),
      el('span', 'bt-nombre', 'octava ' + rollOctava),
      btn('', 'oct +', () => { rollOctava = Math.min(2, rollOctava + 1); renderBottom(); })
    );
    cuerpo.append(filaO);
    const wrap = el('div', 'bt-scroll');
    const grid = el('div', 'bt-grid roll');
    grid.style.gridTemplateColumns = '34px repeat(' + pat.len + ', minmax(14px, 1fr))';
    const NOMBRES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    for (let fila = NOTE_RANGE - 1; fila >= 0; fila--) {
      const semi = fila + rollOctava * 12;
      const negra = [1, 3, 6, 8, 10].includes(fila % 12);
      grid.append(el('div', 'bt-nombre' + (negra ? ' roll-negra' : ''), NOMBRES[fila % 12] + (Math.floor(fila / 12) + 4 + rollOctava)));
      for (let s = 0; s < pat.len; s++) {
        const on = celdas.some(n => n.s === s && n.semi === semi);
        const c = el('button', 'bt-celda roll-celda' + (on ? ' on' : '') + (negra ? ' sombra' : ''));
        c.dataset.step = s;
        c.addEventListener('click', () => {
          const idx = celdas.findIndex(n => n.s === s && n.semi === semi);
          if (idx >= 0) celdas.splice(idx, 1);
          else { celdas.push({ s, semi }); asegurarCtx(); sonarNota(t.params, semi, ctx.currentTime, 0.4, asegurarTrackNodes(trackActual).g); }
          c.classList.toggle('on');
          guardar();
        });
        grid.append(c);
      }
    }
    wrap.append(grid);
    cuerpo.append(wrap);
  }
}

function renderMixer(cuerpo) {
  proyecto.tracks.forEach((t, i) => {
    const fila = el('div', 'bt-fila m01-mixfila');
    fila.append(el('span', 'bt-nombre', (i + 1) + ' ' + (t.inst === 'drumkit' ? 'drums' : PATCHES[t.inst].nombre)));
    const mkSlider = (val, min, max, cb) => {
      const r = el('input');
      r.type = 'range'; r.min = min; r.max = max; r.step = 0.01; r.value = val;
      r.style.width = '80px';
      r.addEventListener('input', () => { cb(+r.value); aplicarMixerTrack(i); guardar(); });
      return r;
    };
    const lv = el('label', '', 'vol '); lv.append(mkSlider(t.vol, 0, 1, v => t.vol = v));
    const lp = el('label', '', 'pan '); lp.append(mkSlider(t.pan, -1, 1, v => t.pan = v));
    const bM = btn(t.mute ? 'activo' : '', 'M', () => { t.mute = !t.mute; bM.classList.toggle('activo', t.mute); proyecto.tracks.forEach((_, j) => aplicarMixerTrack(j)); guardar(); renderTop(); });
    const bS = btn(t.solo ? 'activo' : '', 'S', () => { t.solo = !t.solo; bS.classList.toggle('activo', t.solo); proyecto.tracks.forEach((_, j) => aplicarMixerTrack(j)); guardar(); });
    fila.append(lv, lp, bM, bS);
    cuerpo.append(fila);
  });
  // FX globales con bypass
  cuerpo.append(el('p', 'juego-hud', 'fx globales'));
  const rack = el('div', 'bt-fx');
  const defs = [
    ['delay', 'delayTime', 0, 0.6], ['feedback', 'delayFb', 0, DELAY_FEEDBACK_MAX],
    ['dist', 'dist', 0, 1], ['reverb', 'revMix', 0, 1]
  ];
  defs.forEach(([nombre, prop, min, max]) => {
    const l = el('label', '', nombre);
    const r = el('input');
    r.type = 'range'; r.min = min; r.max = max; r.step = 0.01; r.value = proyecto.fx[prop];
    r.addEventListener('input', () => { proyecto.fx[prop] = Math.min(+r.value, max); if (ctx) aplicarFx(); guardar(); });
    l.append(r);
    rack.append(l);
  });
  const bDel = btn(proyecto.fx.delOn ? 'activo' : '', 'delay on', () => { proyecto.fx.delOn = !proyecto.fx.delOn; bDel.classList.toggle('activo', proyecto.fx.delOn); if (ctx) aplicarFx(); guardar(); });
  const bRev = btn(proyecto.fx.revOn ? 'activo' : '', 'reverb on', () => { proyecto.fx.revOn = !proyecto.fx.revOn; bRev.classList.toggle('activo', proyecto.fx.revOn); if (ctx) aplicarFx(); guardar(); });
  rack.append(bDel, bRev);
  cuerpo.append(rack);
  // export / import de proyecto
  const filaIO = el('div', 'bt-fila');
  filaIO.append(btn('', 'exportar json', () => {
    const blob = new Blob([JSON.stringify(proyecto, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'saudaji-beats-proyecto.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }));
  const inp = el('input');
  inp.type = 'file'; inp.accept = '.json'; inp.style.display = 'none';
  inp.addEventListener('change', () => {
    const f = inp.files[0];
    if (!f) return;
    f.text().then(txt => {
      try {
        const p = JSON.parse(txt);
        if (p.v === 3 && p.tracks) {
          stop();
          proyecto = p; reconstruirParams();
          trackNodes = proyecto.tracks.map(() => null);
          if (ctx) armarMixer();
          trackActual = 0; patronActual = 0;
          guardar(); renderTop(); renderBottom();
        } else alert('JSON no reconocido');
      } catch (e) { alert('JSON inválido'); }
    });
  });
  filaIO.append(btn('', 'importar json', () => inp.click()), inp);
  cuerpo.append(filaIO);
}

function renderKaoss(cuerpo) {
  // pad XY: X/Y mapeados a parámetros del track activo (o del delay global)
  let mapa = 'filtro';
  cuerpo.append(el('p', 'juego-hud', 'pad kaoss — arrastra: X/Y modulan en vivo'));
  const filaM = el('div', 'bt-fila');
  const bF = btn('activo', 'filtro (cutoff/reso)', () => { mapa = 'filtro'; bF.classList.add('activo'); bD.classList.remove('activo'); });
  const bD = btn('', 'delay (time/feedback)', () => { mapa = 'delay'; bD.classList.add('activo'); bF.classList.remove('activo'); });
  filaM.append(bF, bD);
  cuerpo.append(filaM);
  const pad = el('div', 'm01-kaoss');
  const punto = el('div', 'm01-kaoss-punto');
  pad.append(punto);
  let activo = false;
  const mover = (e) => {
    if (!activo) return;
    const r = pad.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    punto.style.left = (x * 100) + '%';
    punto.style.top = ((1 - y) * 100) + '%';
    const t = proyecto.tracks[trackActual];
    if (mapa === 'filtro' && t.params) {
      t.params.cutoff = 60 + x * 7000;
      t.params.res = 0.5 + y * 22;
    } else {
      proyecto.fx.delayTime = x * 0.6;
      proyecto.fx.delayFb = y * DELAY_FEEDBACK_MAX;  // el mapeo mismo respeta el clamp
      if (ctx) aplicarFx();
    }
  };
  pad.addEventListener('pointerdown', (e) => { activo = true; asegurarCtx(); pad.setPointerCapture(e.pointerId); mover(e); });
  pad.addEventListener('pointermove', mover);
  pad.addEventListener('pointerup', () => { activo = false; guardar(); });
  cuerpo.append(pad);
  cuerpo.append(el('p', 'juego-hud', 'modula el track ' + (trackActual + 1) + ' (elige otro arriba) · toca el teclado QWERTY para oírlo'));
}

function renderSong(cuerpo) {
  cuerpo.append(el('p', 'juego-hud', 'song: click cicla · = vacío, 1-8 = patrón · modo canción para reproducirla'));
  const arr = el('div', 'bt-arreglo');
  for (let b = 0; b < SONG_BARS; b++) {
    const c = el('button', 'bt-compas', proyecto.song[b] < 0 ? '·' : String(proyecto.song[b] + 1));
    c.dataset.compas = b;
    c.addEventListener('click', () => {
      proyecto.song[b] = proyecto.song[b] >= NUM_PATTERNS - 1 ? -1 : proyecto.song[b] + 1;
      c.textContent = proyecto.song[b] < 0 ? '·' : String(proyecto.song[b] + 1);
      guardar();
    });
    arr.append(c);
  }
  cuerpo.append(arr);
}

// --- teclado QWERTY (siempre activo dentro del módulo) ---
const NOTAS_QWERTY = [
  ['a', 0], ['w', 1], ['s', 2], ['e', 3], ['d', 4], ['f', 5], ['t', 6],
  ['g', 7], ['y', 8], ['h', 9], ['u', 10], ['j', 11], ['k', 12]
];

function init(container) {
  cargar();
  root = el('div', 'bt-panel m01');
  root.innerHTML =
    '<p class="juego-hud">M01 · espacio = play/stop · teclado QWERTY toca el track activo (ASDF blancas / WETYU negras)</p>' +
    '<div class="m01-top"></div>' +
    '<div class="bt-fila m01-tabs"></div>' +
    '<div class="m01-cuerpo"></div>';
  container.append(root);

  const tabs = root.querySelector('.m01-tabs');
  [['patron', 'patrón'], ['mixer', 'mixer'], ['kaoss', 'kaoss'], ['song', 'song']].forEach(([id, nombre]) => {
    const b = btn(id === tab ? 'activo' : '', nombre, () => { tab = id; renderBottom(); });
    b.dataset.tab = id;
    tabs.append(b);
  });

  renderTop();
  renderBottom();

  onKeyDown = (e) => {
    if (e.key === ' ') { e.preventDefault(); playing ? stop() : play(); return; }
    if (e.repeat) return;
    const nota = NOTAS_QWERTY.find(([k]) => k === e.key.toLowerCase());
    if (nota) tocarEnVivo(nota[1]);
  };
  onKeyUp = () => {};
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  onVis = () => { if (document.hidden && playing) stop(); };
  document.addEventListener('visibilitychange', onVis);
}

function destroy() {
  stop();
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  document.removeEventListener('visibilitychange', onVis);
  if (ctx) { ctx.close(); ctx = null; nodos = null; trackNodes = []; buffers = { drums: {}, keys: {} }; }
  if (root) { root.remove(); root = null; }
}

export default { init, destroy };
