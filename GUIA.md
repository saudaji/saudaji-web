# Guía para actualizar tu sitio (sin código)

Todo el texto de la **bio**, los **links** y los proyectos de **trabajo** viven en
un solo archivo: `content.json`. Nunca necesitas tocar `index.html`.

## Cambiar la bio o agregar un proyecto

1. **Abre `admin.html`** — doble click al archivo, se abre en tu navegador.
   (Funciona sin internet, no sube nada a ningún lado.)
2. En "Paso 1", **carga el `content.json`** actual de la carpeta del sitio.
3. **Edita** lo que quieras:
   - *Bio*: cambia el texto. Deja una línea en blanco entre párrafos.
   - *Links*: pega las URLs completas (con `https://`).
   - *Portafolio*: usa **+ agregar proyecto** para uno nuevo, las flechas **↑ ↓**
     para reordenar, y **✕ borrar** para quitar.
4. Abajo, dale **⬇ Descargar content.json**.
5. **Reemplaza** el `content.json` viejo de la carpeta del sitio con el que
   descargaste (arrástralo y acepta reemplazar).
6. **Sube el cambio** (ver "Publicar" abajo). Listo — refresca el sitio y ahí está.

## Agregar una imagen de portada

1. Copia tu imagen (JPG o PNG, cuadrada se ve mejor) a la carpeta `assets/`
   del sitio. Ejemplo: `assets/covers/mi-disco.jpg`.
2. En el editor, en el campo **Portada** del proyecto, escribe esa ruta:
   `assets/covers/mi-disco.jpg`.
   (También sirve pegar una URL de internet, pero si esa página borra la
   imagen, tu sitio se queda sin portada — mejor tenerla en tu carpeta.)
3. Descarga, reemplaza y sube igual que siempre.

## Publicar los cambios

El sitio vive en GitHub Pages. Después de reemplazar `content.json`:

- **Con GitHub Desktop** (lo más fácil): abre la app, verás el cambio,
  escribe un mensajito (ej. "nuevo proyecto") y dale **Commit** → **Push**.
- **Con Terminal**: dentro de la carpeta del sitio:
  ```
  git add content.json
  git commit -m "actualizo contenido"
  git push
  ```

En un minuto los cambios están en línea.

## Si algo sale mal

- ¿El sitio se ve igual que antes? Refresca con Cmd+Shift+R (fuerza recarga).
- ¿El sitio quedó con el texto viejo de respaldo? El `content.json` que subiste
  tiene un error de formato — vuelve a abrirlo en `admin.html` (si carga, está
  bien; si no, descarga uno nuevo desde el editor).
- Nada de esto puede "romper" el sitio: si `content.json` falla, la página
  muestra el contenido de respaldo que trae adentro.
