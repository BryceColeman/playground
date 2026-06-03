/* grab-directory.src.js — readable source for the "Ward Names" capture
 * bookmarklet, tuned for directory.churchofjesuschrist.org.
 * Build it into a one-line `javascript:` URL with build.mjs.
 *
 * What it does on the directory page you're viewing:
 *   1. reads the structured HTML for every member (name + photo) and every
 *      household (family name + family photo) — see extractCards()
 *   2. fetches each photo and bundles them into one ZIP, each image named after
 *      the person (e.g. "Erik Alvarez.jpg") or family ("Alvarez, Erik & Jenna.jpg")
 *   3. downloads the ZIP, which unzips into a folder of named images
 *
 * The ZIP is written by a tiny built-in writer (store / no compression) so the
 * bookmarklet has NO external dependencies — important because the directory's
 * Content Security Policy blocks loading scripts from a CDN.
 *
 * Targeting is based on STABLE anchors, not the styled-component class hashes
 * (sc-xxxxxxx) which change between site builds:
 *   • member name + id : <a href="/{unit}/members/{uuid}">Full Name</a>
 *   • member photo     : /api/v4/photos/members/{uuid}
 *   • family photo     : /api/v4/photos/households/{uuid}
 *   • family name      : the <h1> within the same household header
 */
(function () {
  'use strict';

  // ── tiny on-page status panel ──────────────────────────────────────────
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:330px;' +
    'background:#1a1830;color:#e8e6f0;font:13px/1.45 -apple-system,sans-serif;' +
    'border:1px solid #4834d4;border-radius:12px;padding:14px 16px;' +
    'box-shadow:0 8px 40px rgba(0,0,0,.5)';
  document.body.appendChild(panel);
  const say = (html) => {
    panel.innerHTML = '<b>📖 Ward Names capture</b><br>' + html;
  };
  say('Starting…');

  // ── minimal ZIP writer (store method, no external deps) ─────────────────
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (bytes) => {
    let c = ~0;
    for (let i = 0; i < bytes.length; i++)
      c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (~c) >>> 0;
  };

  // files: [{ name, data: Uint8Array }] -> Blob (a valid .zip, store method)
  const makeZip = (files) => {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;
      const lh = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); // local file header sig
      dv.setUint16(4, 20, true); // version needed
      dv.setUint16(6, 0x0800, true); // UTF-8 filename
      dv.setUint16(8, 0, true); // store
      dv.setUint32(14, crc, true);
      dv.setUint32(18, size, true);
      dv.setUint32(22, size, true);
      dv.setUint16(26, nameBytes.length, true);
      lh.set(nameBytes, 30);
      parts.push(lh, f.data);

      const ch = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); // central dir header sig
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true); // store
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true); // offset of local header
      ch.set(nameBytes, 46);
      central.push(ch);
      offset += lh.length + size;
    }
    let centralSize = 0;
    for (const c of central) centralSize += c.length;
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); // end of central dir sig
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    return new Blob([...parts, ...central, eocd], { type: 'application/zip' });
  };

  // Make a safe, readable file name from a person's / family's name.
  const sanitize = (name) =>
    (name || 'unknown')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[\/\\:*?"<>|]/g, '-') // illegal filename chars
      .slice(0, 80) || 'unknown';

  const extFromType = (type) => {
    if (/png/i.test(type)) return 'png';
    if (/webp/i.test(type)) return 'webp';
    if (/gif/i.test(type)) return 'gif';
    return 'jpg';
  };

  const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const photoUrl = (type, id) =>
    new URL(`/api/v4/photos/${type}/${id}`, location.origin).href;

  /* ── extractCards(): returns [{ name, fullUrl, thumbUrl }] ──────────────
   * fullUrl is tried first (higher resolution); thumbUrl is the known-good
   * thumbnail the page itself loads, used as a fallback.
   */
  function extractCards() {
    const out = [];
    const seen = new Set();

    // Individual members — every profile link is "{name}" → /members/{uuid}.
    document.querySelectorAll('a[href*="/members/"]').forEach((a) => {
      const m = (a.getAttribute('href') || '').match(UUID);
      if (!m) return;
      const id = m[1];
      const name = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (!id || !name || seen.has(id)) return;
      seen.add(id);
      out.push({
        name,
        fullUrl: photoUrl('members', id),
        thumbUrl: photoUrl('members', id) + '?thumbnail=true',
      });
    });

    // Households — family photo named after the household heading (<h1>).
    document.querySelectorAll('img[src*="/photos/households/"]').forEach((img) => {
      const m = (img.getAttribute('src') || '').match(UUID);
      if (!m) return;
      const id = m[1];
      if (seen.has(id)) return;
      // Nearest ancestor that contains the household's <h1> heading.
      let el = img;
      let name = '';
      for (let i = 0; i < 8 && el; i++) {
        const h1 = el.querySelector && el.querySelector('h1');
        if (h1 && h1.textContent.trim()) {
          name = h1.textContent.trim();
          break;
        }
        el = el.parentElement;
      }
      if (!name) return;
      seen.add(id);
      out.push({
        name: name.replace(/\s+/g, ' '),
        fullUrl: photoUrl('households', id),
        thumbUrl: photoUrl('households', id) + '?thumbnail=true',
      });
    });

    return out;
  }

  async function fetchPhoto(card) {
    // Try full resolution first, fall back to the page's thumbnail.
    for (const url of [card.fullUrl, card.thumbUrl]) {
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (res.ok) {
          const blob = await res.blob();
          if (blob.size > 0) return blob;
        }
      } catch (e) {
        /* try next */
      }
    }
    return null;
  }

  // ── main ────────────────────────────────────────────────────────────────
  (async function run() {
    try {
      const cards = extractCards();
      if (!cards.length) {
        say(
          '⚠ Found no members on this page.<br>Open a ward/household view first, then click again.'
        );
        return;
      }

      const entries = []; // { name, data: Uint8Array }
      const used = new Map(); // de-dupe identical file names
      const failed = [];
      let done = 0;

      for (const card of cards) {
        say(`Fetching ${++done} / ${cards.length}…<br><small>${card.name}</small>`);
        const blob = await fetchPhoto(card);
        if (!blob) {
          failed.push(card.name);
          continue;
        }
        let base = sanitize(card.name);
        const n = (used.get(base) || 0) + 1;
        used.set(base, n);
        if (n > 1) base += ` (${n})`;
        entries.push({
          name: `${base}.${extFromType(blob.type)}`,
          data: new Uint8Array(await blob.arrayBuffer()),
        });
      }

      const saved = entries.length;
      if (!saved) {
        say('⚠ Could not fetch any photos (are you logged in?).');
        return;
      }

      say('Building ZIP…');
      const out = makeZip(entries);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(out);
      a.download = 'ward-photos.zip';
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(a.href);
      a.remove();

      say(
        `✓ Saved ${saved} photo(s) to ward-photos.zip.` +
          (failed.length
            ? `<br>⚠ ${failed.length} had no photo: ` +
              failed.slice(0, 4).join(', ') +
              (failed.length > 4 ? '…' : '')
            : '') +
          '<br><small>Click to dismiss.</small>'
      );
      panel.style.cursor = 'pointer';
      panel.onclick = () => panel.remove();
    } catch (err) {
      say('⚠ ' + err.message);
    }
  })();
})();
