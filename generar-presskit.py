#!/usr/bin/env python3
"""
Genera saudaji-presskit.pdf a partir de content.json (bio + highlights + música
solista + portafolio) y de las fotos que haya en assets/fotos/.

Uso:  python3 generar-presskit.py

Layout fijo en 3 páginas: (1) bio + highlights + música solista, (2) fotos de
prensa, (3) portafolio + contacto.

Es "fácil de manejar": editas el contenido en admin.html (o a mano en content.json),
dejas tus fotos en assets/fotos/, corres este comando y el PDF se actualiza.

Requiere:  pip3 install fpdf2 pillow
"""

import json, os, sys, glob, tempfile, urllib.request

try:
    from fpdf import FPDF
except ImportError:
    sys.exit("Falta fpdf2. Instálalo con:  pip3 install fpdf2")

try:
    from PIL import Image
except ImportError:
    Image = None

AQUI = os.path.dirname(os.path.abspath(__file__))
CONTENT = os.path.join(AQUI, "content.json")
LOGO = os.path.join(AQUI, "saudajilogoraw.png")
FOTOS_DIR = os.path.join(AQUI, "assets", "fotos")
SALIDA = os.path.join(AQUI, "saudaji-presskit.pdf")

VERDE = (60, 121, 92)
CREMA = (242, 239, 230)
SUAVE = (200, 205, 196)
ROJO = (217, 43, 43)

# Fuente Unicode del sistema para ☼ ☞ ☺, «», — y acentos (fpdf2 la subsetea).
FUENTES_UNI = [
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
]
UNI = next((f for f in FUENTES_UNI if os.path.exists(f)), None)


def bajar_cover(url, cache):
    if not url:
        return None
    if url in cache:
        return cache[url]
    try:
        if url.startswith("http"):
            destino = os.path.join(tempfile.gettempdir(), "pk_" + str(abs(hash(url))) + ".jpg")
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=15) as r, open(destino, "wb") as f:
                f.write(r.read())
            cache[url] = destino
            return destino
        ruta = os.path.join(AQUI, url)
        cache[url] = ruta if os.path.exists(ruta) else None
        return cache[url]
    except Exception as e:
        print("  · portada no disponible (" + url[:40] + "...):", e)
        return None


def reducida(ruta, max_lado=1400):
    try:
        im = Image.open(ruta).convert("RGB")
        im.thumbnail((max_lado, max_lado))
        tmp = os.path.join(tempfile.gettempdir(), "pkfoto_" + str(abs(hash(ruta))) + ".jpg")
        im.save(tmp, "JPEG", quality=82)
        return tmp, im.size
    except Exception as e:
        print("  · foto no procesable (" + os.path.basename(ruta) + "):", e)
        return None, None


class PressKit(FPDF):
    def header(self):
        self.set_fill_color(*VERDE)
        self.rect(0, 0, self.w, self.h, "F")


def main():
    with open(CONTENT, encoding="utf-8") as f:
        c = json.load(f)
    bio = c.get("bio", {})
    links = c.get("links", {})
    porta = c.get("portafolio", [])
    highlights = c.get("highlights", [])
    musica = c.get("musica", [])
    cache = {}

    pdf = PressKit(format="A4")
    pdf.set_auto_page_break(False)
    if UNI:
        pdf.add_font("uni", "", UNI)
    pdf.add_page()
    y = [18]

    def fijar_fuente(txt, size, bold):
        if UNI and any(ord(ch) > 255 for ch in txt):
            pdf.set_font("uni", "", size)
        else:
            reemp = {"—": "-", "–": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "..."}
            for a, b in reemp.items():
                txt = txt.replace(a, b)
            txt = txt.encode("latin-1", "replace").decode("latin-1")
            pdf.set_font("helvetica", "B" if bold else "", size)
        return txt

    def titulo(t):
        txt = fijar_fuente(t.upper(), 10, True)
        pdf.set_xy(20, y[0])
        pdf.set_text_color(*SUAVE)
        pdf.cell(0, 6, " ".join(txt), align="C")
        y[0] += 9

    def parrafo(t, size=10.5, color=CREMA, gap=3):
        txt = fijar_fuente(t, size, False)
        pdf.set_xy(25, y[0])
        pdf.set_text_color(*color)
        pdf.multi_cell(160, 5.2, txt, align="C")
        y[0] = pdf.get_y() + gap

    def bullet(t, size=9.5):
        txt = fijar_fuente("-  " + t, size, False)
        pdf.set_xy(28, y[0])
        pdf.set_text_color(*CREMA)
        pdf.multi_cell(154, 4.8, txt, align="C")
        y[0] = pdf.get_y() + 1.5

    def grid_covers(items, ancho, cover_h, cap_reserva, cap_fn, link_fn=None, permitir_salto=True):
        cols, gap = 3, 8
        celda = cover_h + cap_reserva
        x0 = (210 - (cols * ancho + (cols - 1) * gap)) / 2
        for i, p in enumerate(items):
            col = i % cols
            if col == 0 and i > 0:
                y[0] += celda
                if permitir_salto and y[0] + celda > 285:
                    pdf.add_page()
                    y[0] = 20
            x = x0 + col * (ancho + gap)
            img = bajar_cover(p.get("cover", ""), cache)
            url = (link_fn(p) if link_fn else "") or ""
            if img:
                try:
                    # link= hace la portada clickeable (abre la página para escuchar)
                    pdf.image(img, x=x, y=y[0], w=ancho, h=cover_h, link=url)
                except Exception:
                    pass
            cap_fn(p, x, y[0] + cover_h + 2, ancho, url)
        y[0] += celda

    def cap_musica(p, x, yy, w, url=""):
        pdf.set_xy(x, yy)
        pdf.set_text_color(*CREMA)
        fijar_fuente(p.get("titulo", ""), 8.5, True)
        pdf.multi_cell(w, 3.6, p.get("titulo", ""), align="C", link=url)
        pdf.set_xy(x, pdf.get_y())
        pdf.set_text_color(*SUAVE)
        det = " · ".join(v for v in [p.get("formato", ""), str(p.get("año", ""))] if v)
        etiqueta = det + ("  ▶ escuchar" if url else "")
        fijar_fuente(etiqueta, 7.5, False)
        pdf.multi_cell(w, 3.2, etiqueta, align="C", link=url)

    def cap_porta(p, x, yy, w, url=""):
        pdf.set_xy(x, yy)
        pdf.set_text_color(*CREMA)
        fijar_fuente(p.get("titulo", ""), 8.5, True)
        pdf.multi_cell(w, 3.6, p.get("titulo", ""), align="C", link=url)
        pdf.set_xy(x, pdf.get_y())
        pdf.set_text_color(*SUAVE)
        meta = p.get("artista", "")
        if p.get("año"):
            meta += " - " + str(p["año"])
        fijar_fuente(meta, 7.5, False)
        pdf.multi_cell(w, 3.2, meta, align="C", link=url)
        pdf.set_xy(x, pdf.get_y())
        rol = p.get("rol", "")
        fijar_fuente(rol, 6.8, False)
        pdf.multi_cell(w, 3, rol, align="C")

    # ============ PÁGINA 1: bio + highlights + música solista ============
    if os.path.exists(LOGO):
        pdf.image(LOGO, x=58, y=16, w=94)
    y[0] = 52
    titulo("press kit")
    pdf.set_draw_color(*ROJO)
    pdf.set_line_width(1.6)
    pdf.line(85, y[0], 125, y[0])
    y[0] += 8

    titulo("sobre saudaji")
    for parr in bio.get("texto", "").split("\n\n"):
        if parr.strip():
            parrafo(parr.strip())
    y[0] += 2

    if highlights:
        titulo("highlights")
        for h in highlights:
            bullet(h)
        y[0] += 3

    if musica:
        titulo("musica solista")
        # la portada abre el link de escucha (YouTube donde exista, si no el smart-link)
        grid_covers(musica, 34, 34, 14, cap_musica,
                    link_fn=lambda p: p.get("escuchar") or p.get("link"),
                    permitir_salto=False)

    # ============ PÁGINA 2: fotos de prensa ============
    fotos = sorted(glob.glob(os.path.join(FOTOS_DIR, "*.jpg")) +
                   glob.glob(os.path.join(FOTOS_DIR, "*.jpeg")) +
                   glob.glob(os.path.join(FOTOS_DIR, "*.png")))
    if fotos and Image:
        pdf.add_page()
        y[0] = 24
        titulo("fotos")
        y[0] += 4
        margen, gap = 22, 8
        util = 210 - 2 * margen
        # dos filas de altura fija; ancho por proporción, centrado
        filas, fila, ancho_fila = [], [], 0
        alto = 74
        for ruta in fotos:
            chica, tam = reducida(ruta)
            if not chica:
                continue
            w = alto * tam[0] / tam[1]
            if fila and ancho_fila + w + gap > util:
                filas.append((fila, ancho_fila))
                fila, ancho_fila = [], 0
            fila.append((chica, w))
            ancho_fila += w + (gap if len(fila) > 1 else 0)
        if fila:
            filas.append((fila, ancho_fila))
        for items, total_w in filas:
            x = (210 - total_w) / 2
            for ruta, w in items:
                try:
                    pdf.image(ruta, x=x, y=y[0], w=w, h=alto)
                except Exception:
                    pass
                x += w + gap
            y[0] += alto + gap
    elif fotos and not Image:
        print("  · fotos encontradas pero falta Pillow (pip3 install pillow) — omitidas")

    # ============ PÁGINA 3: portafolio + contacto ============
    if porta:
        pdf.add_page()
        y[0] = 24
        titulo("portafolio")
        y[0] += 2
        grid_covers(porta, 48, 48, 24, cap_porta,
                    link_fn=lambda p: p.get("link"), permitir_salto=True)
        y[0] += 6

    def fila_links(items, size=9, sep="     ·     ", gap=2.2):
        # una fila centrada con varios enlaces; cada texto abre su url por separado
        items = [(t, u) for t, u in items if u]
        if not items:
            return
        pdf.set_font("helvetica", "", size)  # los nombres de red son ASCII
        anchos = [pdf.get_string_width(t) for t, _ in items]
        ws = pdf.get_string_width(sep)
        total = sum(anchos) + ws * (len(items) - 1)
        x = (210 - total) / 2
        for i, (t, u) in enumerate(items):
            pdf.set_xy(x, y[0])
            pdf.set_text_color(*SUAVE)
            pdf.cell(anchos[i], 5.4, t, align="L", link=u)
            x += anchos[i]
            if i < len(items) - 1:
                pdf.set_xy(x, y[0])
                pdf.cell(ws, 5.4, sep, align="L")
                x += ws
        y[0] += 5.4 + gap

    salto_c = (285 - y[0]) < 42
    if porta and salto_c:
        pdf.add_page()
        y[0] = 24
    titulo("contacto")
    email = links.get("email", "saudaji@saudaji.com")
    t = fijar_fuente(email, 11.5, True)
    pdf.set_text_color(*CREMA)
    pdf.set_xy(20, y[0])
    pdf.cell(170, 6, t, align="C", link="mailto:" + email)
    y[0] += 10
    fila_links([
        ("Instagram @_saudaji", links.get("instagram")),
        ("X @saudaji_", links.get("x")),
        ("TikTok @saudaji_", links.get("tiktok")),
    ])
    fila_links([
        ("Spotify", links.get("spotify")),
        ("SoundCloud", links.get("soundcloud")),
        ("Bandcamp", links.get("bandcamp")),
        ("saudaji.com", links.get("web")),
    ])

    pdf.output(SALIDA)
    print("PDF generado:", SALIDA, "(fuente unicode:", "sí)" if UNI else "no)")


if __name__ == "__main__":
    main()
