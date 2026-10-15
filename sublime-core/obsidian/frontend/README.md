# OBSIDIAN Frontend

The CEP panel UI lives here.

- `index.html` — panel markup and relative asset references.
- `styles.css` — visual design and animations.
- `app.js` — input handling and CEP bridge calls.
- `assets/` — frontend-only images, icons, and other static resources.

Keep After Effects project mutation and host-side scripting out of this folder. The frontend should call the bridge and display observed results; it must not claim an edit succeeded merely because a request was sent.
