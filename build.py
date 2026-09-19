#!/usr/bin/env python3
"""Build mc.uhsmathclub.org into _site/.

Sources of truth:
    site.yml      site-wide config (the Apps Script endpoint)
    home.yml      home page content, one key per language
    tryouts.md    tryouts page, front matter + one block per language
    resources.md  resources page, English only
    templates/    page templates, stylesheet, scripts

Run:  python build.py
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from xml.sax.saxutils import escape

import yaml
from jinja2 import Environment, FileSystemLoader, StrictUndefined
from markdown_it import MarkdownIt
from markupsafe import Markup
from PIL import Image

ROOT = Path(__file__).parent
OUT = ROOT / "_site"
TEMPLATES = ROOT / "templates"

DOMAIN = "mc.uhsmathclub.org"
LANGS = {"en": "en", "zh": "zh-Hans", "ko": "ko"}
IMAGE_WIDTHS = (800, 1600)
SIZES = "(min-width: 48rem) 736px, 100vw"

md = MarkdownIt("commonmark").enable("table")

# YAML folds a wrapped line into a space, and markdown does the same with a
# soft line break. Chinese does not use spaces between characters, so a
# paragraph wrapped for readability in home.yml would render with gaps in it.
# Hangul is deliberately excluded: Korean *does* space its words.
_CJK = "[\u3000-\u303F\u4E00-\u9FFF\uF900-\uFAFF\uFF01-\uFF60]"
_CJK_GAP = re.compile(f"(?<={_CJK})[ \n]+(?={_CJK})")


def fold_cjk(text: str) -> str:
    """Drop whitespace that sits between two CJK characters."""
    return _CJK_GAP.sub("", text)


# --------------------------------------------------------------------------
# template helpers
# --------------------------------------------------------------------------

def i18n(node: dict, tag: str = "p", cls: str = "") -> Markup:
    """Render one translated string as sibling blocks, one per language.

    Visibility is decided in CSS from [data-lang] on <html>, so the correct
    language is painted on the first frame with no flash.
    """
    if not isinstance(node, dict):
        raise TypeError(f"expected a mapping of languages, got {node!r}")

    attr = f' class="{cls}"' if cls else ""
    parts = []
    for key, html_lang in LANGS.items():
        if key not in node:
            raise KeyError(f"missing '{key}' translation in {node!r}")
        parts.append(
            f'<{tag} lang="{html_lang}"{attr}>{escape(str(node[key]))}</{tag}>'
        )
    return Markup('<div class="i18n">' + "".join(parts) + "</div>")


def picture(node: dict, eager: bool = False) -> Markup:
    """Render a responsive <picture> from a {src, alt} node."""
    src = node["src"]
    alt = node["alt"]
    stem = Path(src).stem
    variants = IMAGES[src]

    webp = ", ".join(f"/{stem}-{w}.webp {w}w" for w in variants)
    jpeg = ", ".join(f"/{stem}-{w}.jpg {w}w" for w in variants)
    widest = max(variants)
    width, height = variants[widest]

    alt_attrs = " ".join(
        f'data-{key}-alt="{escape(str(alt[key]), {chr(34): "&quot;"})}"'
        for key in ("zh", "ko")
    )

    return Markup(
        f'<picture><source type="image/webp" srcset="{webp}" sizes="{SIZES}">'
        f'<img src="/{stem}-{widest}.jpg" srcset="{jpeg}" sizes="{SIZES}" '
        f'width="{width}" height="{height}" '
        f'loading="{"eager" if eager else "lazy"}" '
        f'decoding="async" '
        f'alt="{escape(str(alt["en"]), {chr(34): "&quot;"})}" {alt_attrs}></picture>'
    )


# --------------------------------------------------------------------------
# content loading
# --------------------------------------------------------------------------

def load_yaml(name: str) -> dict:
    return yaml.safe_load((ROOT / name).read_text(encoding="utf-8"))


def load_tryouts() -> tuple[dict, Markup]:
    """Split front matter from per-language markdown blocks."""
    raw = (ROOT / "tryouts.md").read_text(encoding="utf-8")
    _, front, body = raw.split("---", 2)
    meta = yaml.safe_load(front)

    blocks = re.split(r"<!--lang:(\w+)-->", body)[1:]
    rendered = []
    for key, chunk in zip(blocks[0::2], blocks[1::2]):
        if key not in LANGS:
            raise KeyError(f"tryouts.md has an unknown language block: {key}")
        rendered.append(
            f'<div lang="{LANGS[key]}">{md.render(chunk.strip())}</div>'
        )

    missing = set(LANGS) - set(blocks[0::2])
    if missing:
        raise KeyError(f"tryouts.md is missing language blocks: {sorted(missing)}")

    return meta, Markup('<div class="i18n">' + "".join(rendered) + "</div>")


# --------------------------------------------------------------------------
# images
# --------------------------------------------------------------------------

def build_images(sources: list[str]) -> dict:
    """Write webp + jpg at each width. Returns {src: {width: (w, h)}}."""
    table = {}
    for src in sources:
        image = Image.open(ROOT / src)
        if image.mode != "RGB":
            image = image.convert("RGB")
        stem = Path(src).stem
        variants = {}

        for width in IMAGE_WIDTHS:
            if width > image.width:
                continue
            height = round(image.height * width / image.width)
            resized = image.resize((width, height), Image.LANCZOS)
            resized.save(OUT / f"{stem}-{width}.jpg", quality=82, optimize=True,
                         progressive=True)
            resized.save(OUT / f"{stem}-{width}.webp", quality=80, method=6)
            variants[width] = (width, height)

        if not variants:
            height = image.height
            image.save(OUT / f"{stem}-{image.width}.jpg", quality=82, optimize=True)
            image.save(OUT / f"{stem}-{image.width}.webp", quality=80, method=6)
            variants[image.width] = (image.width, height)

        table[src] = variants
        print(f"  {src} -> {sorted(variants)}")
    return table


# --------------------------------------------------------------------------
# icons
# --------------------------------------------------------------------------

def minify_svg() -> str:
    """Strip the XML prolog and the <style> block, inlining the two fills."""
    raw = (ROOT / "mc_favicon.svg").read_text(encoding="utf-8")
    path = re.search(r'<path class="cls-2"[^>]*\sd="([^"]+)"', raw).group(1)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 170.18 170.18">'
        '<clipPath id="c"><circle cx="85.09" cy="85.09" r="85.09"/></clipPath>'
        '<circle cx="85.09" cy="85.09" r="85.09" fill="#132749"/>'
        f'<path clip-path="url(#c)" fill="#fdb717" d="{path}"/>'
        "</svg>"
    )


def build_icons(svg_path: Path) -> None:
    """Rasterize the logo. Needs rsvg-convert; skipped with a warning if absent."""
    if shutil.which("rsvg-convert") is None:
        print("  ! rsvg-convert not found - skipping PNG/ICO icons")
        return

    sizes = {"icon-192.png": 192, "icon-512.png": 512, "apple-touch-icon.png": 180}
    for name, size in sizes.items():
        subprocess.run(
            ["rsvg-convert", "-w", str(size), "-h", str(size),
             str(svg_path), "-o", str(OUT / name)],
            check=True,
        )

    subprocess.run(
        ["rsvg-convert", "-w", "256", "-h", "256", str(svg_path),
         "-o", str(OUT / "_ico.png")],
        check=True,
    )
    Image.open(OUT / "_ico.png").save(
        OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)]
    )
    (OUT / "_ico.png").unlink()
    print(f"  icons: {', '.join(sizes)}, favicon.ico")


# --------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------

def main() -> int:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    site = load_yaml("site.yml")
    home = load_yaml("home.yml")
    tryouts_meta, tryouts_body = load_tryouts()

    endpoint = (site.get("apps_script_url") or "").strip()
    if not endpoint:
        print("  ! site.yml has no apps_script_url - /hello will not work")

    print("images:")
    global IMAGES
    IMAGES = build_images(
        [home["main"]["picture"]["src"]] + [p["src"] for p in home["pictures"]]
    )

    env = Environment(
        loader=FileSystemLoader(TEMPLATES),
        autoescape=True,
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    logo = Markup(minify_svg().replace("<svg ", '<svg aria-hidden="true" focusable="false" '))
    env.globals.update(i18n=i18n, picture=picture, logo=logo)

    pages = [
        ("index.html", "index.html", {
            "title": "Rancho MATHCOUNTS",
            "description": "A weekly after-school math enrichment program at "
                           "Rancho San Joaquin Middle School.",
            "page": "home",
            "home": home,
        }),
        ("tryouts.html", "tryouts/index.html", {
            "title": "Tryouts — Rancho MATHCOUNTS",
            "description": "When MATHCOUNTS tryouts happen and when registration opens.",
            "page": "tryouts",
            "meta": tryouts_meta,
            "body": tryouts_body,
        }),
        ("resources.html", "resources/index.html", {
            "title": "Resources — Rancho MATHCOUNTS",
            "description": "Books, practice sites, and past exams for "
                           "MATHCOUNTS preparation.",
            "page": "resources",
            "body": Markup(md.render(
                (ROOT / "resources.md").read_text(encoding="utf-8"))),
        }),
        ("hello.html", "hello/index.html", {
            "title": "Check In — Rancho MATHCOUNTS",
            "description": None,
            "page": "hello",
            "noindex": True,
            "endpoint": endpoint,
        }),
        ("404.html", "404.html", {
            "title": "Page Not Found — Rancho MATHCOUNTS",
            "description": None,
            "page": "404",
            "noindex": True,
        }),
    ]

    print("pages:")
    for template_name, target, context in pages:
        context.setdefault("noindex", False)
        html = fold_cjk(env.get_template(template_name).render(**context))
        destination = OUT / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(html, encoding="utf-8")
        print(f"  /{target}")

    # static assets
    for name in ("site.css", "site.js", "hello.js"):
        shutil.copy(TEMPLATES / name, OUT / name)

    svg = minify_svg()
    (OUT / "mc_favicon.svg").write_text(svg, encoding="utf-8")
    original = (ROOT / "mc_favicon.svg").stat().st_size
    print(f"icons:\n  mc_favicon.svg {original} -> {len(svg.encode())} bytes")
    build_icons(ROOT / "mc_favicon.svg")

    (OUT / "site.webmanifest").write_text(json.dumps({
        "name": "Rancho MATHCOUNTS",
        "short_name": "MATHCOUNTS",
        "icons": [
            {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"},
        ],
        "theme_color": "#132749",
        "background_color": "#fbf7ef",
        "display": "browser",
    }, indent=2), encoding="utf-8")

    (OUT / "CNAME").write_text(DOMAIN + "\n", encoding="utf-8")
    (OUT / ".nojekyll").write_text("", encoding="utf-8")
    (OUT / "robots.txt").write_text(
        f"User-agent: *\nDisallow: /hello/\n\nSitemap: https://{DOMAIN}/sitemap.xml\n",
        encoding="utf-8",
    )

    urls = "".join(
        f"<url><loc>https://{DOMAIN}{path}</loc></url>"
        for path in ("/", "/tryouts/", "/resources/")
    )
    (OUT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>\n',
        encoding="utf-8",
    )

    # The Apps Script fallback shares the stylesheet and the language switch
    # with the site, pulled in with printing scriptlets so there is one copy
    # of each. Both files are generated; edit templates/, never these.
    for target, source, wrapper in (
        ("Stylesheet.html", "site.css", "style"),
        ("Script.html", "site.js", "script"),
    ):
        (ROOT / target).write_text(
            f"<!-- GENERATED BY build.py FROM templates/{source} - DO NOT EDIT -->\n"
            f"<{wrapper}>\n"
            + (TEMPLATES / source).read_text(encoding="utf-8")
            + f"</{wrapper}>\n",
            encoding="utf-8",
        )
        print(f"apps script:\n  {target} regenerated from templates/{source}"
              if target == "Stylesheet.html" else f"  {target} regenerated from templates/{source}")

    print(f"\ndone -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
