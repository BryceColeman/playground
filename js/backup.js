// backup.js — export/import everything to a single JSON file. Because data is
// local-only, this is how you guard against a cleared browser and move between
// devices. Photo blobs are encoded as data URLs inside the JSON.
import {
  allPeople,
  allHouseholds,
  putPerson,
  putHousehold,
  clearAll,
} from './db.js';

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(url) {
  const res = await fetch(url);
  return res.blob();
}

export async function exportBackup() {
  const [people, households] = await Promise.all([
    allPeople(),
    allHouseholds(),
  ]);
  const serialPeople = await Promise.all(
    people.map(async (p) => ({
      ...p,
      photo: p.photo instanceof Blob ? await blobToDataUrl(p.photo) : null,
    }))
  );
  const payload = {
    app: 'ward-names',
    version: 1,
    exportedAt: new Date().toISOString(),
    households,
    people: serialPeople,
  };
  const blob = new Blob([JSON.stringify(payload)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ward-names-backup-${new Date()
    .toISOString()
    .slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// replace=true wipes existing data first; otherwise merges by id.
export async function importBackup(file, { replace = false } = {}) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (data.app !== 'ward-names')
    throw new Error('Not a Ward Names backup file.');
  if (replace) await clearAll();

  for (const h of data.households || []) await putHousehold(h);
  for (const p of data.people || []) {
    const photo =
      typeof p.photo === 'string' ? await dataUrlToBlob(p.photo) : null;
    await putPerson({ ...p, photo });
  }
  return { people: (data.people || []).length };
}
