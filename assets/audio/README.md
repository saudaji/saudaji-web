# Audio para BEATS (drum machine del sitio)

El módulo `js/beats.js` busca los samples aquí. Si un archivo no existe,
la app NO truena: esa voz suena con un sintetizador de respaldo y en la
consola aparece un aviso `[beats] sin sample ...`.

## Convención de nombres (respétala tal cual)

Batería — un WAV corto por sonido:

```
assets/audio/drums/kick.wav
assets/audio/drums/snare.wav
assets/audio/drums/hihat.wav
assets/audio/drums/clap.wav
assets/audio/drums/tom.wav
assets/audio/drums/crash.wav
```

Teclado — UN solo WAV por instrumento, afinado en **C4 (do central, 261.63 Hz)**.
El módulo lo transpone con playbackRate para cubrir todo el teclado.
Solo los patches "Piano" y "Rhodes" usan samples — los bajos (Acid/Moog/Loco)
y el DX7 E.Piano son 100% sintetizados y no necesitan archivos:

```
assets/audio/keys/piano.wav     ← piano acústico real (síntesis no lo aproxima bien)
assets/audio/keys/rhodes.wav    ← opcional: sin archivo suena el fallback FM+tremolo
```

## Recomendaciones
- WAV 44.1 kHz, mono o estéreo. Cortos (drums < 1 s, keys 1-3 s).
- Sin silencio al inicio del archivo (arruina el timing del secuenciador).
- Si cambias un nombre, cámbialo también en `DRUM_NAMES` / `VOICE_NAMES`
  al inicio de `js/beats.js`.
