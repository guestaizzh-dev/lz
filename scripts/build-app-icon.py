"""Render the existing calligraphy font into a reproducible App icon SVG."""
from pathlib import Path
import sys
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'work/python-tools'))
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

font = TTFont(root / 'apps/mobile/static/fonts/AcademyCalligraphy.ttf')
glyphs = font.getGlyphSet()
name = font.getBestCmap()[ord('道')]
bounds = BoundsPen(glyphs)
glyphs[name].draw(bounds)
x0, y0, x1, y1 = bounds.bounds
scale = 342 / max(x1 - x0, y1 - y0)
pen = SVGPathPen(glyphs)
glyphs[name].draw(pen)
dx = 256 - (x0 + x1) / 2 * scale
dy = 256 + (y0 + y1) / 2 * scale
output = root / 'apps/mobile/static/brand'
output.mkdir(exist_ok=True)
(output / 'app-icon.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#17292D"/><rect x="35" y="35" width="442" height="442" rx="8" fill="none" stroke="#E6D6BD" stroke-width="3"/><path d="{pen.getCommands()}" transform="translate({dx} {dy}) scale({scale} {-scale})" fill="#E6D6BD"/></svg>', encoding='utf-8')
print('Rendered existing calligraphy glyph as App icon.')
