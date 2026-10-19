"""Generate offline, playable manual-test media; no third-party course material."""
from pathlib import Path
import math
import struct
import subprocess
import sys
import wave

from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / '.runtime' / 'manual-test-media'
root.mkdir(parents=True, exist_ok=True)
image = Image.new('RGB', (960, 540), '#f5f1e8')
draw = ImageDraw.Draw(image)
title = ImageFont.truetype('C:/Windows/Fonts/simsun.ttc', 46)
body = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 24)
draw.line([(90, 380), (270, 265), (430, 365), (625, 215), (860, 385)], fill='#d9ded5', width=9)
draw.text((105, 100), '上善若水 · 研习课件', font=title, fill='#283b34')
draw.text((110, 190), '手动测试专用｜视频播放、暂停与进度同步', font=body, fill='#52635a')
draw.text((110, 445), '本片为本地生成的播放样本，非真实名师授课。', font=body, fill='#52635a')
image.save(root / 'study.png')
with wave.open(str(root / 'audio.wav'), 'wb') as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(24000)
    samples = bytearray()
    for n in range(20 * 24000):
        t = n / 24000
        envelope = min(1, t / 2, (20 - t) / 2)
        value = int(1600 * envelope * (math.sin(2 * math.pi * 220 * t) + .3 * math.sin(2 * math.pi * 330 * t)))
        samples.extend(struct.pack('<h', value))
    wav.writeframes(samples)
subprocess.run([
    imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-loglevel', 'error',
    '-loop', '1', '-i', str(root / 'study.png'), '-i', str(root / 'audio.wav'),
    '-t', '20', '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-movflags', '+faststart', str(root / 'video.mp4'),
], check=True)
print('Generated: study.png, audio.wav (20s), video.mp4 (20s, H.264/AAC)')
