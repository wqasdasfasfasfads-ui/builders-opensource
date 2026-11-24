# Costumes

This is where the Marketplace page gets its items from. It is empty
right now, so `/marketplace` shows "nothing here yet".

To add a costume, create a subfolder with a `costume.json` file inside it:

```
costumes/
  red-hoodie/
    costume.json
```

`costume.json`:

```json
{
  "name": "Red Hoodie",
  "description": "A stylish hoodie for your character.",
  "price": 0
}
```

`price` is a number of coins - buying the costume deducts that many
coins from the player's balance (players get 20 free coins every day).
Use `0` (or leave it out) for a free costume.

Optionally, drop an `icon.png` (`.jpg`/`.jpeg`/`.webp`/`.gif` also work)
next to `costume.json` - that's the picture shown for this item on the
Marketplace page. If there's no icon file, one is drawn automatically
from the costume's `colors`. Both `price` and the icon file are set
here, by hand - there's no edit/upload option on the website itself.

The `../games` folder works the same way, but for games instead (no
price or icon).

## 3D voxel hats (the "hat" field)

A costume can also carry a 3D hat built from cubes. The website passes
the whole `hat` object through to the game automatically - it shows up
inside `equipped_costume` in the `/api/game-login` and `/api/profile`
responses. The Godot game spawns one box (BoxMesh) per entry, so the
hat's look is 100% data, no model files:

```json
{
  "name": "Black Cap",
  "price": 0,
  "colors": {...},
  "hat": {
    "blocks": [
      {"pos": [0.0, 0.55, 0.0],  "size": [1.10, 0.55, 1.10], "color": "#1a1a1a"},
      {"pos": [0.0, 0.90, 0.0],  "size": [0.80, 0.20, 0.80],  "color": "#1a1a1a"},
      {"pos": [0.0, 0.48, 0.85], "size": [0.95, 0.12, 0.70],  "color": "#111111"}
    ]
  }
}
```

- `hat: null` (or no `hat` field) = no hat.
- Each block:
  - `pos`   - [x, y, z] center of the cube, relative to the head
              attachment point. **Y = up, Z = toward the face.**
  - `size`  - [width, height, depth] of the cube. Units are "head
              widths" (1.0 ~ the width of the character's head), so the
              same numbers work for every character size - the game
              multiplies them by the actual head size.
  - `color` - HTML hex color of the cube.
- Adding a new hat = new folder + `costume.json` with a `hat.blocks`
  list. Nothing else to change anywhere.

See `black-cap` (cap: dome + top + brim) and `green-beanie` (beanie:
dome + fold + pom-pom) for working examples.

## Offsale (items that are not sold any more)

To stop selling a costume, drop an empty file named `ofsale.json` (the
spelling `offsale.json` works too) into that costume's folder:

```
costumes/
  ninja/
    costume.json
    ofsale.json     <- Marketplace shows "Offsale" instead of the price
```

- The Marketplace shows **Offsale** instead of the price and there is no
  Get button; buying is also blocked in the in-game shop.
- Players who **already own** the costume keep it and can still equip it, so
  old items keep working.
- You can still hand it out with a code from `/codes/` (see `codes/README.md`).
- Delete `ofsale.json` to put it back on sale. Animations work the same way
  (`animations/<id>/ofsale.json`).

## 2D T-shirts (the "shirt" field)

A costume can also be a **2D shirt**: a picture wrapped around the torso and
both arms (same idea as a Roblox T-shirt). Players make them on the website
at **/clothing/create** (Marketplace -> "Make a T-shirt"), but you can also
make one by hand:

```
costumes/
  red-tee/
    costume.json     { "name": "Red Tee", "price": 20, "shirt": { "texture": "shirt.png" } }
    shirt.png        585 x 559 PNG, the classic shirt template (transparent = body color shows)
    icon.png         optional Marketplace picture
```

- The PNG layout is described in `public/shirt-layout.json` (every box is
  `[x, y, width, height]`). It is the classic Roblox shirt template.
- Only one shirt is shown at a time (the last worn one wins). Hats, shorts
  and colors still work together with it.
- Shirts made by players wait in `clothingwaiting/` until an admin presses
  **Publish** on `/admin` (the admin can set the price there). **Reject**
  moves the folder to `clothingrejected/` - nothing is deleted. Admins' own
  shirts are published immediately.
- The picture is served at `/costume-texture/<id>` (no login needed, so the
  game can download it with a plain GET).
