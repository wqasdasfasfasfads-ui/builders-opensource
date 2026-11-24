# Animations

Emote/social animations for the game. Works exactly like `../costumes`:
create a subfolder with an `animation.json` inside and it automatically
shows up in the Marketplace (Animations section) and in the game's
animation menu (T). Adding a new animation = adding a new folder here,
no code changes anywhere.

```json
{
  "name": "Wave",
  "description": "Wave your right arm.",
  "price": 10,
  "loop": false,
  "duration": 2.0,
  "tracks": {
    "right_arm": [
      { "t": 0.0, "rot": [0.0, 0.0, 0.0] },
      { "t": 0.5, "rot": [0.0, 0.0, -2.4] },
      { "t": 2.0, "rot": [0.0, 0.0, 0.0] }
    ]
  }
}
```

- `price` - coins on the Marketplace (0 = free).
- `loop` - `true` repeats until cancelled (T again / move), `false` plays once.
- `duration` - total seconds.
- `tracks` - one entry per body part, each a list of keyframes:
  - part names: `head`, `torso`, `left_arm`, `right_arm`, `left_leg`, `right_leg`
  - `t` - time in seconds
  - `rot` - [x, y, z] rotation in radians, interpolated between keyframes
    (the game lerps; first/last keyframe should usually match the rest pose)

The whole file (including `tracks`) is sent to the game in
`owned_animations` inside the `/api/game-login` and `/api/profile`
responses.
