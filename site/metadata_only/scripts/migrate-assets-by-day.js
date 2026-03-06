#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const LANG_FILES = ['entries.it.json', 'entries.en.json', 'entries.es.json', 'entries.fr.json'];

const ASSET_TYPE_BY_KEY = {
  src: null,
  thumb: 'thumb',
  poster: 'poster',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeDate(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function detectTypeFromAssetPath(assetPath, key, mime) {
  if (typeof assetPath !== 'string' || !assetPath.startsWith('assets/')) {
    if (key === 'src') {
      if ((mime || '').startsWith('video/')) return 'video_resized';
      return 'img';
    }
    return ASSET_TYPE_BY_KEY[key];
  }
  const parts = assetPath.split('/').filter(Boolean);
  if (parts.length >= 2) return parts[1];
  if (key === 'src') {
    if ((mime || '').startsWith('video/')) return 'video_resized';
    return 'img';
  }
  return ASSET_TYPE_BY_KEY[key];
}

function migratePhysicalFilesFromItalian() {
  const itPath = path.join(DATA_DIR, 'entries.it.json');
  const itData = readJson(itPath);
  const moves = new Map();

  for (const day of itData.days || []) {
    for (const item of day.items || []) {
      const date = normalizeDate(item.date || day.date);
      if (!date) continue;
      for (const key of ['src', 'thumb', 'poster']) {
        const value = item[key];
        if (typeof value !== 'string' || value.trim() === '' || !value.startsWith('assets/')) continue;
        const basename = path.basename(value);
        const type = detectTypeFromAssetPath(value, key, item.mime);
        const oldPathRel = value;
        const newPathRel = path.posix.join('assets', type, date, basename);
        if (oldPathRel === newPathRel) {
          // Recovery mode: JSON already rewritten to dated paths but file still in flat legacy folder.
          const legacyFlatRel = path.posix.join('assets', type, basename);
          if (!moves.has(legacyFlatRel)) {
            moves.set(legacyFlatRel, newPathRel);
          }
          continue;
        }
        if (!moves.has(oldPathRel)) {
          moves.set(oldPathRel, newPathRel);
        }
      }
    }
  }

  let moved = 0;
  let skipped = 0;
  let missing = 0;

  for (const [oldRel, newRel] of moves.entries()) {
    const oldAbs = path.join(ROOT, oldRel);
    const newAbs = path.join(ROOT, newRel);

    ensureDir(path.dirname(newAbs));

    if (fs.existsSync(newAbs)) {
      if (fs.existsSync(oldAbs) && oldAbs !== newAbs) {
        skipped += 1;
      }
      continue;
    }

    if (!fs.existsSync(oldAbs)) {
      missing += 1;
      continue;
    }

    try {
      fs.renameSync(oldAbs, newAbs);
      moved += 1;
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'EXDEV')) {
        // ENOENT: source disappeared between checks, EXDEV: cross-device fallback not supported by rename.
        missing += 1;
        continue;
      }
      throw error;
    }
  }

  return { planned: moves.size, moved, skipped, missing };
}

function rewriteEntriesPaths() {
  const perFile = [];

  for (const fileName of LANG_FILES) {
    const filePath = path.join(DATA_DIR, fileName);
    const data = readJson(filePath);
    let changes = 0;

    for (const day of data.days || []) {
      for (const item of day.items || []) {
        const date = normalizeDate(item.date || day.date);
        if (!date) continue;
        for (const key of ['src', 'thumb', 'poster']) {
          const value = item[key];
          if (typeof value !== 'string' || value.trim() === '' || !value.startsWith('assets/')) continue;
          const basename = path.basename(value);
          const type = detectTypeFromAssetPath(value, key, item.mime);
          const newRel = path.posix.join('assets', type, date, basename);
          if (value !== newRel) {
            item[key] = newRel;
            changes += 1;
          }
        }
      }
    }

    writeJson(filePath, data);
    perFile.push({ fileName, changes });
  }

  return perFile;
}

function verifyEntriesAssetsExist() {
  const missing = [];

  for (const fileName of LANG_FILES) {
    const data = readJson(path.join(DATA_DIR, fileName));
    for (const day of data.days || []) {
      for (const item of day.items || []) {
        for (const key of ['src', 'thumb', 'poster']) {
          const value = item[key];
          if (typeof value !== 'string' || value.trim() === '' || !value.startsWith('assets/')) continue;
          const abs = path.join(ROOT, value);
          if (!fs.existsSync(abs)) {
            missing.push({ file: fileName, date: day.date, id: item.id, key, path: value });
          }
        }
      }
    }
  }

  return missing;
}

function main() {
  const mode = String(process.argv[2] || 'all');
  const doMove = mode === 'all' || mode === 'move';
  const doRewrite = mode === 'all' || mode === 'rewrite';
  const doVerify = mode === 'all' || mode === 'verify';

  let moveStats = { planned: 0, moved: 0, skipped: 0, missing: 0 };
  let rewriteStats = [];
  let missing = [];

  if (doMove) {
    console.log('[1/3] Moving physical files...');
    moveStats = migratePhysicalFilesFromItalian();
  }
  if (doRewrite) {
    console.log('[2/3] Rewriting entries paths...');
    rewriteStats = rewriteEntriesPaths();
  }
  if (doVerify) {
    console.log('[3/3] Verifying referenced assets...');
    missing = verifyEntriesAssetsExist();
  }

  const report = {
    moveStats,
    rewriteStats,
    missingCount: missing.length,
    missingSample: missing.slice(0, 30),
    generatedAt: new Date().toISOString(),
  };

  const reportPath = path.join(DATA_DIR, 'asset_migration_by_day_report.json');
  writeJson(reportPath, report);

  console.log(`[done] mode=${mode} report: ${reportPath}`);
  console.log(JSON.stringify(report, null, 2));
  if (missing.length > 0) {
    process.exitCode = 2;
  }
}

main();
