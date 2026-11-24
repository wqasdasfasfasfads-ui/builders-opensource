# Events

Every subfolder here is one event shown at the top of the **Games** page.
Put two things in the folder:

```
events/
  summer-party/
    photo.png       <- the picture (png / jpg / webp / gif, any name)
    event.json      <- { "url": "https://example.com", "name": "Summer party" }
```

Instead of `event.json` you can also use `link.txt` (the link on the first
line) or a Windows `.url` shortcut. Click the picture on the Games page ->
the site from the link opens in a new tab. A folder without a link or
without a picture is skipped. Changes apply immediately, no restart needed.
