// build.mjs — turn grab-directory.src.js into a one-line `javascript:`
// bookmarklet, and generate a drag-to-install page. No minifier needed:
// encodeURIComponent preserves newlines (%0A) so // line comments stay valid.
//
//   node bookmarklet/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(dir, 'grab-directory.src.js'), 'utf8');

// Drop the leading /* ... */ banner comment to keep the URL a little shorter.
const code = src.replace(/^\/\*[\s\S]*?\*\/\s*/, '');
const bookmarklet =
  'javascript:' + encodeURIComponent(code + '\n;void 0;');

writeFileSync(join(dir, 'grab-directory.bookmarklet.txt'), bookmarklet);

const installHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Install · Ward Names photo grabber</title>
<style>
  body{font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    background:#0f0e1a;color:#e8e6f0;max-width:680px;margin:0 auto;padding:32px 20px}
  h1{color:#a29bfe}a.bm{display:inline-block;background:#6C5CE7;color:#fff;
    text-decoration:none;font-weight:800;padding:12px 20px;border-radius:10px;margin:8px 0}
  ol{padding-left:22px}li{margin:10px 0}code{background:#221f3b;padding:2px 6px;border-radius:5px}
  .note{color:#8b87a8;font-size:14px}.box{background:#1a1830;border:1px solid #2d2a4a;
    border-radius:12px;padding:18px 20px;margin:18px 0}
</style></head><body>
<h1>📖 Ward Names — photo grabber</h1>
<p>Drag this button to your bookmarks bar to install it:</p>
<p><a class="bm" href="${bookmarklet.replace(/"/g, '&quot;')}">📖 Grab Ward Photos</a></p>
<div class="box">
<ol>
  <li>Log in to <code>directory.churchofjesuschrist.org</code> and open your ward
      (or a household).</li>
  <li>Click the <b>Grab Ward Photos</b> bookmark.</li>
  <li>It collects every member + family photo and downloads
      <code>ward-photos.zip</code> — unzip it to get a folder of images named
      after each person (e.g. <code>Erik Alvarez.jpg</code>).</li>
</ol>
<p class="note">Everything runs in your browser, using your logged-in session.
No photos are sent anywhere else. People without a profile photo are listed at
the end and skipped.</p>
</div>
<p class="note">Can't drag to the bookmarks bar (e.g. on mobile)? Create any
bookmark, then edit it and replace its URL with the contents of
<code>grab-directory.bookmarklet.txt</code>.</p>
</body></html>`;

writeFileSync(join(dir, 'install.html'), installHtml);

console.log(
  `Built bookmarklet (${bookmarklet.length} chars) → grab-directory.bookmarklet.txt + install.html`
);
