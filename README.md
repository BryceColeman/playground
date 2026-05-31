# 📖 Ward Names

A private, offline-first web app for learning the names of families in your
ward. Import your directory screenshots, let OCR pull the names off them, then
quiz yourself each Sunday with spaced-repetition study modes.

**Everything stays on your device.** Photos and names are stored in your
browser (IndexedDB) and never uploaded anywhere.

## Using it

Open `index.html` (best served over `http://localhost` or any static host so
the offline/PWA features work; you can also open the file directly).

1. **Import** – pick one or more directory screenshots. Line the on-screen grid
   up to the household cards (set rows/columns, drag the *Name band* slider so
   the blue line sits just above the names), then **Run OCR**. Review and fix
   any misread names, then save.
2. **People** – add, edit, delete people manually; attach a photo and a
   *mnemonic note* (e.g. "tall, red beard, sits in back") to anchor the name.
3. **Study** – run a session each Sunday:
   - **Smart Mix** (recommended) graduates each person from multiple-choice →
     typing → flashcards as you get better.
   - **Multiple Choice** – pick from four. Easiest, good for new faces.
   - **Type the Name** – type from memory; strongest for retention.
   - **Flashcards** – recall, reveal, self-grade.
4. **Backup** – data is local-only, so export a backup regularly (and to move
   to another device). Also sets how many new faces to introduce per session.

## How the learning works

A spaced-repetition scheduler (an SM-2 variant) tracks how well you know each
person, resurfaces the weak ones, and pushes well-known faces further out.
Sessions interleave households (rather than drilling one family at a time) and
introduce only a handful of new people at once.

## Install on your phone

It's a PWA — open it in your phone browser and "Add to Home Screen" to install
it. After the first load it works offline (your data is local). OCR needs
internet the first time to fetch the engine, then is cached for offline use.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App shell |
| `css/styles.css` | Styles |
| `js/db.js` | IndexedDB storage layer |
| `js/srs.js` | Spaced-repetition scheduler |
| `js/ocr.js` | Screenshot grid-slicing + Tesseract.js OCR |
| `js/study.js` | The three study modes + session runner |
| `js/backup.js` | JSON export/import |
| `js/app.js` | Navigation, dashboard, import & people screens |
| `sw.js`, `manifest.webmanifest` | Offline/PWA support |

> `contact-map.html` is an unrelated earlier project, kept for reference.
