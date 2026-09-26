# Your own typeface

Put the `.woff2` files here, next to a `fonts.css` that declares them, then set
`"font": "YourFace"` in `store.json`. The build imports this folder's `fonts.css`
automatically when `store.json` names a face that isn't one of the built-in presets.

There is an example in `fonts.css.example`: copy it to `fonts.css` and edit it.

Self-hosting is why the store stays fast and private — nothing is fetched from Google
or anyone else. Check you have the right to use the face on a commercial store.
