# Habit Tracker — GitHub Pages

A static web page (HTML + CSS + plain JavaScript, no build step and no dependencies) that creates a
printable radial habit tracker for any month. Everything runs in the browser; nothing is uploaded.

## Features

- Main page: month/year, number of habit lines, name and quote, with a live preview.
- Gear button: settings dialog with tabs for the habit list, the sheet labels (titles, headers, box
  titles, quote author) and the page (paper size, orientation, wheel angle, colors, resolution).
- Download as **PDF** (ready to print), **PNG** or **SVG**. A **Share** button appears where the
  browser can share files (mostly mobile).
- 16 languages: English, Spanish, Portuguese, Dutch, Italian, German, Polish, Ukrainian, Romanian,
  Mandarin Chinese, Hindi, Arabic, French,
  Bengali, Russian and Urdu. The browser's preferred language is used by default; the chosen language
  and the settings are remembered in `localStorage`. Changing the language changes the page and the
  generated sheet (labels and quote that were not edited by the user).
- Every output includes the source URL (PDF: clickable link; PNG: printed and in a `tEXt` chunk;
  SVG: printed as a link).

## Files

| File | Purpose |
|---|---|
| `index.html` | Page markup |
| `css/app.css` | Styles (light/dark, responsive) |
| `js/config.js` | **Source URL printed on every sheet — change it after publishing** |
| `js/i18n.js` | Translations (page texts and default sheet texts) |
| `js/renderer.js` | Layout of the sheet (scene in points) and SVG / canvas / PNG output |
| `js/pdf.js` | Minimal single-page PDF writer (image of the sheet + link) |
| `js/app.js` | Form state, persistence, preview, download and share |

## Publishing

Copy the folder contents to the root of the repository (or a `docs/` folder) and enable GitHub Pages
for that branch/folder. `.nojekyll` makes Pages serve the files as they are. Then edit
`js/config.js` (`sourceUrl` and `sourceLabel`) if the printed URL (currently
`https://tinyurl.com/radial-habits`) ever changes.

## Running locally

Any static server works, e.g. `python -m http.server 8000` in this folder and open
`http://localhost:8000/`. (Opening `index.html` directly from disk also works in most browsers.)

## License

[MIT](LICENSE) © 2026 Juan Antonio Castillo (jachguate). You may use, copy, modify and distribute this project,
including commercially, as long as the copyright notice and the license text are kept in all copies
or substantial portions of it.

The default quote printed on the sheet is a line from the film *Rocky Balboa* (2006); it is not
covered by this license.
