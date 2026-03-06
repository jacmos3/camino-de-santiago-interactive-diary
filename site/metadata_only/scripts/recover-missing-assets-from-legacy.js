#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const ENTRIES = path.join(ROOT, 'data', 'entries.it.json');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function typeFromPath(p) {
  const parts = String(p).split('/').filter(Boolean);
  return parts[1] || null;
}

const data = JSON.parse(fs.readFileSync(ENTRIES, 'utf8'));
let moved = 0;
let missing = 0;
let already = 0;

for (const day of data.days || []) {
  for (const item of day.items || []) {
    for (const key of ['src', 'thumb', 'poster']) {
      const rel = item[key];
      if (typeof rel !== 'string' || !rel.startsWith('assets/')) continue;
      const abs = path.join(ROOT, rel);
      if (fs.existsSync(abs)) {
        already += 1;
        continue;
      }
      const type = typeFromPath(rel);
      if (!type) continue;
      const legacyRel = path.posix.join('assets', type, path.basename(rel));
      const legacyAbs = path.join(ROOT, legacyRel);
      if (!fs.existsSync(legacyAbs)) {
        missing += 1;
        continue;
      }
      ensureDir(path.dirname(abs));
      try {
        fs.renameSync(legacyAbs, abs);
        moved += 1;
      } catch {
        if (fs.existsSync(legacyAbs)) {
          fs.copyFileSync(legacyAbs, abs);
          fs.unlinkSync(legacyAbs);
          moved += 1;
        }
      }
    }
  }
}

console.log(JSON.stringify({ moved, missing, already }, null, 2));
