# Codes

Codes players type on the **/readem** page. Every code is a file (or a
folder) in this folder. The code the player types is the **file name** (or
folder name) - it is not case-sensitive.

Two ways to make a code:

```
codes/
  WELCOME.json            <- the code is WELCOME
  NINJA2026/
    code.json             <- the code is NINJA2026
```

You can also put `"code": "SOMETHING"` inside the json to override the name.

## What is inside the json

```json
{
  "coins": 50,
  "costume": "ninja",
  "costumes": ["red-hoodie", "ice"],
  "animation": "dance",
  "animations": ["wave"],
  "maxUses": 100,
  "expires": "2026-12-31",
  "disabled": false
}
```

Everything is optional, use only what you need (an empty `{}` gives nothing):

- `coins` - coins added to the balance.
- `costume` / `costumes` - costume folder name(s) from `/costumes/`. Works
  even for **offsale** costumes, so a code is a nice way to give out a rare item.
- `animation` / `animations` - animation folder name(s) from `/animations/`.
- `maxUses` - how many players in total can use the code (missing or 0 = unlimited).
- `expires` - date (`"2026-12-31"`) after which the code stops working.
- `disabled` - `true` turns the code off without deleting it.

Every player can use each code only once (remembered in `data/codes.json`).
If a code only gives things the player already owns, it is not used up.
After 10 wrong codes in 10 minutes a player has to wait a bit.

`EXAMPLE.json` here is disabled and only shows the format.
