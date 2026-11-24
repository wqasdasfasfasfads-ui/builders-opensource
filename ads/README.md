# Ad banners

This folder holds the images shown in the two side banners (left and
right of the page content) on every logged-in page. It's empty right
now, so the banners simply don't show up - nothing breaks.

To show ads, just drop image files straight into this folder:

```
ads/
  banner1.png
  banner2.jpg
  summer-sale.webp
```

- Accepted formats: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`.
- **Size: 112 × 451 px.** That's the fixed size the banner slots are
  drawn at, so images at that size will look sharp - anything else gets
  stretched/cropped to fit.
- No `banner.json` or naming convention needed - every image file in
  here is fair game.
- On every page load, the server picks one image at random for the left
  slot and one (independently) for the right slot. With one image in
  the folder, both sides show the same one. With several, they'll mix.
- There's no upload/manage option on the website itself - add or remove
  files here directly, same as `games/` and `costumes/`.
