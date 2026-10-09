"""Prepare licensed editorial assets. Run with Pillow/fontTools installed.

Sources and reproduction rules are in static/editorial/SOURCES.md.
Original downloads are local research files; do not commit them.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset

root = Path(__file__).resolve().parents[1]
research = root / 'work/research'
out = root / 'apps/mobile/static/editorial'
fonts = root / 'apps/mobile/static/fonts'
out.mkdir(parents=True, exist_ok=True)
fonts.mkdir(parents=True, exist_ok=True)
font = instantiateVariableFont(TTFont(research / 'NotoSerifSC.ttf'), {'wght': 500}, inplace=True)
options = subset.Options()
subsetter = subset.Subsetter(options=options)
chars = set(chr(i) for i in range(32, 127))
for high in range(0xA1, 0xF8):
    for low in range(0xA1, 0xFF):
        try: chars.update(bytes([high, low]).decode('gb2312'))
        except UnicodeDecodeError: pass
for path in (root / 'apps/mobile').rglob('*.uvue'):
    chars.update(path.read_text(encoding='utf-8'))
chars.update('道德經道學書院研習上善若水致虛極守靜篤')
subsetter.populate(text=''.join(chars))
subsetter.subset(font)
font.save(fonts / 'AcademySerif.ttf')
(fonts / 'OFL.txt').write_text((research / 'font-license.txt').read_text(encoding='utf-8'), encoding='utf-8')

for source, target in [('landscape-full.jpg', 'landscape-01.jpg'), ('landscape2-full.jpg', 'landscape-02.jpg'), ('landscape3-full.jpg', 'landscape-03.jpg')]:
    im = Image.open(research / source).convert('RGB')
    im.thumbnail((1400, 1600))
    im.save(out / target, quality=90, optimize=True)

def serif(size): return ImageFont.truetype(str(fonts / 'AcademySerif.ttf'), size)
def book(filename, title, subtitle, cloth):
    # Original book cover design, explicitly a development mock-up.
    im = Image.new('RGB', (720, 840), '#eeeae0')
    shadow = Image.new('RGBA', im.size)
    sd = ImageDraw.Draw(shadow)
    sd.polygon([(172, 135), (577, 116), (602, 730), (200, 757)], fill=(35, 40, 36, 65))
    im = Image.alpha_composite(im.convert('RGBA'), shadow.filter(ImageFilter.GaussianBlur(20)))
    d = ImageDraw.Draw(im)
    d.polygon([(139, 104), (546, 104), (569, 714), (161, 714)], fill='#d8d1bd')
    d.polygon([(151, 100), (554, 100), (554, 700), (151, 700)], fill=cloth)
    d.rectangle((153, 100, 169, 700), fill='#25353a')
    d.rectangle((190, 140, 514, 661), outline='#aca58e', width=2)
    d.rectangle((369, 149, 479, 511), fill='#eee8d8')
    for i, ch in enumerate(title): d.text((394, 175+i*66), ch, font=serif(54), fill='#283336')
    d.text((208, 596), subtitle, font=serif(28), fill='#e9e1cf')
    d.line((174, 148, 174, 646), fill='#a8a49a', width=2)
    for y in [178, 279, 431, 570, 639]: d.line((155, y, 185, y+2), fill='#e3dbcb', width=4)
    im.convert('RGB').save(out / filename, quality=93, optimize=True)
book('book-classic.jpg', '道德经', '经典研读册', '#2e454b')
book('book-journal.jpg', '研习录', '老子道学书院', '#786d5c')
book('book-notes.jpg', '摘录集', '经典摘录卡', '#4d5350')
print('Editorial assets prepared; original downloads excluded.')
