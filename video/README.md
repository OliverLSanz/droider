# Promo video

A 74-second tour of Droider made in code with [Remotion](https://www.remotion.dev), in
the style of the website. It recreates VS Code (Dark Modern) with the extension
installed, so typing, suggestions, hovers and squiggles can be animated, and uses the
extension's own renders for the Hardware View and the Circuit Graph.

```sh
npm ci
npm run studio            # edit with a live preview and timeline
npm run render            # out/droider-tour.mp4, 16:9 1920×1080 at 60 fps (H.264 + AAC)
npm run render:vertical   # out/droider-tour-vertical.mp4, 9:16 1080×1920 for Shorts/Reels/TikTok
npm run thumbnail         # out/youtube-thumbnail.png and .jpg, 1280×720
npm run web               # site/assets/video/tour.mp4 + tour-poster.webp, docs/media/tour-preview.gif
```

`npm run web` needs `out/droider-tour.mp4`, `ffmpeg` and `cwebp`.

## How it fits together

- `src/score.ts` is the single score: tempo, scene boundaries, story beats and the
  notes. The soundtrack and the animation both read it, so they stay in sync.
- `npm run audio` (run by `studio` and `render`) synthesises `public/soundtrack.wav`
  from the score, with no samples, normalised to -14 LUFS. It is git-ignored. The music
  is what `examples/melody.ini` patches: a square-LFO clock, a 16-step Euclidean rhythm,
  random notes snapped by `[minifonion]` to the chord tones of C natural minor, and a
  `[contour]` pluck; the bass voice of `examples/duet.droider` joins in the `.droider`
  scene.
- `src/stories.ts` holds every state that is typed on screen.
- `src/generated/patch.json` is everything the video shows that comes from the
  extension: the example patches, the linter's messages for every typed state, hover
  texts, completion lists, cable colours and the expanded `dist/duet.ini`. It is
  committed, so rendering does not need the extension built. To refresh it after
  changing the extension or the examples:

  ```sh
  (cd .. && npm run compile) && npm run data
  ```

- `src/highlight.ts` colours text the way the extension does (grammar, semantic tokens
  and rainbow cables); `scripts/gen-data.ts` checks its cable colours against the
  extension's `colorForCable`.
- Both formats come from the same scenes; `src/layout.ts` holds the format each scene
  reads to place its caption and panels.
- `public/` holds the icon and the extension's own webview renders (Hardware View and
  Circuit Graph), converted to WebP.
