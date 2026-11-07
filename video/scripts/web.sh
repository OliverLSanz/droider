#!/bin/sh
# Web copies of the rendered tour, for the website and the GitHub README:
#   ../site/assets/video/tour.mp4         16:9, 30 fps, two-pass to stay under ~12 MB, faststart
#   ../site/assets/video/tour-poster.webp a frame of the title, 1920 wide
#   ../docs/media/tour-preview.gif        the autocomplete scene, 800 px wide, looping
# Needs out/droider-tour.mp4 (npm run render), ffmpeg and cwebp.
set -e
cd "$(dirname "$0")/.."
SRC=out/droider-tour.mp4
SITE=../site/assets/video
DOCS=../docs/media
mkdir -p "$SITE" "$DOCS" out/tmp

# 1150 kb/s video + 96 kb/s audio ≈ 11.5 MB for 74 s.
ffmpeg -y -loglevel error -i "$SRC" -an -c:v libx264 -preset slow -b:v 1150k -r 30 -pix_fmt yuv420p -pass 1 -passlogfile out/tmp/pass -f mp4 /dev/null
ffmpeg -y -loglevel error -i "$SRC" -c:v libx264 -preset slow -b:v 1150k -r 30 -pix_fmt yuv420p -pass 2 -passlogfile out/tmp/pass \
  -c:a aac -b:a 96k -movflags +faststart "$SITE/tour.mp4"

# Poster: the title card, with the tagline in.
npx remotion still Demo out/tmp/poster.png --frame=720 --log=error
cwebp -quiet -q 86 -m 6 -resize 1920 0 out/tmp/poster.png -o "$SITE/tour-poster.webp"

# GIF: writing the [contour] block with autocomplete (steps 137–183 of src/score.ts).
ffmpeg -y -loglevel error -ss 18.4 -t 6.4 -i "$SRC" -vf "fps=20,scale=800:-1:flags=lanczos,palettegen=max_colors=256:stats_mode=diff" out/tmp/palette.png
ffmpeg -y -loglevel error -ss 18.4 -t 6.4 -i "$SRC" -i out/tmp/palette.png \
  -lavfi "fps=20,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" -loop 0 "$DOCS/tour-preview.gif"

rm -rf out/tmp
ls -lh "$SITE/tour.mp4" "$SITE/tour-poster.webp" "$DOCS/tour-preview.gif"
