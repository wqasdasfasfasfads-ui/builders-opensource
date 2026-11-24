# Places

This is where `builders://place?id=xxxxxx` deep links get their file
from. It works like `games/` and `costumes/`, but with one important
difference: **place links are meant to be opened by anyone, without
logging in** - there's no code, no session, just the id. So don't put
anything here you don't want downloadable by whoever has the link.

To add a place, create a subfolder with a `place.json` file plus the
actual level/scene file sitting right next to it:

```
places/
  forest-clearing/
    place.json
    level.tscn        <- whatever file your Godot project actually needs
```

`place.json`:

```json
{
  "name": "Forest Clearing",
  "description": "A small clearing with a fountain in the middle.",
  "file": "level.tscn",
  "id": "forest-clearing"
}
```

- `id` is optional - if you leave it out, the folder name
  (`forest-clearing` above) is used instead. Whatever `id` you pick is
  exactly what goes in the link: `builders://place?id=forest-clearing`.
- `file` is required and must match the filename of the level file in
  that same folder - it can be a `.tscn`, an exported/packed resource,
  a `.zip`, or your own custom format, whatever the Godot side expects
  to receive and load. That file's raw bytes are exactly what gets
  served.

## How a link turns into a file

1. Something (a page on this site, a message, wherever) shows a link
   like `builders://place?id=forest-clearing`.
2. The OS sees `builders://` and launches the desktop app with that URL
   (same OS-level registration as `builders://play`, see
   `../GODOT-DEEP-LINK.md` - one registration covers every action).
3. The app parses out `id=forest-clearing` and downloads:
   - `GET /api/places/forest-clearing` for the metadata (so it knows
     the real filename/extension to save), then
   - `GET /api/places/forest-clearing/file` for the actual bytes.
4. Both endpoints are public - no login, no code, no session. Anyone
   with the id can fetch that place.

The `../games` and `../costumes` folders work the same way on disk,
but those stay behind login since they're reached through the
website's own pages, not shared links.
