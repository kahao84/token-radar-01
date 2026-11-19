// Token Radar radar-3 — entry point.
//
// Usage: node main.ts [snapshot.json] [out-dir]
// Defaults: ../token-radar-01-kit/input/snapshot.json and ./out
// Reads the DefiLlama snapshot, builds the 200-row board with the fitted
// radar-3 model, copies the dashboard into out/, and writes dossier.json
// with the kit's buildDossier helper (dossier is always written last).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoDir = dirname(fileURLToPath(import.meta.url));
const snapshotPath = resolve(process.argv[2] ?? join(repoDir, '..', 'token-radar-01-kit', 'input', 'snapshot.json'));
const outDir = resolve(process.argv[3] ?? join(repoDir, 'out'));

const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const result = buildBoard(snapshot);
const { rows, validation, fits, points, kpis, meta } = result;

mkdirSync(join(outDir, 'dashboard'), { recursive: true });

// 1. board.json — the 200-row board, sorted by implied value desc.
writeFileSync(join(outDir, 'board.json'), JSON.stringify(rows, null, 2) + '\n');

// 2. data.js — everything the dashboard needs, as one global.
const payload = { meta, kpis, rows, validation, fits, points };
writeFileSync(join(outDir, 'data.js'), 'window.RADAR = ' + JSON.stringify(payload) + ';\n');

// 3. dashboard files, copied from the repo's dashboard/ source.
for (const f of ['index.html', 'app.css', 'app.js']) {
  writeFileSync(join(outDir, 'dashboard', f), readFileSync(join(repoDir, 'dashboard', f)));
}

// 4. dossier.json — built last, from the finished out/ directory.
const dossier = buildDossier(outDir, {
  text_max_bytes: 65536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(outDir, 'dossier.json'), dossier);

// Summary for the build log.
const fmt = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
console.log(`radar-3 build OK — ${rows.length} rows, ${meta.protocols} protocols, control group ${meta.controlN} launched`);
console.log(`#1 ${kpis.topName} — implied ${fmt(kpis.topImpliedUsd)}`);
console.log(`median fitted multiple ${kpis.medianMultiple.toFixed(4)}x; global R2 ${kpis.globalR2.toFixed(4)}; ${meta.categoriesFitted} category curves`);
console.log(`out-of-sample: median APE ${validation.overall.medianApePct.toFixed(2)}%, within ±25% ${validation.overall.within25Pct.toFixed(2)}% (n=${validation.overall.n})`);
for (const f of validation.folds) {
  console.log(`  fold ${f.fold}: n=${f.n} median APE ${f.medianApePct.toFixed(2)}% within ±25% ${f.within25Pct.toFixed(2)}%`);
}
console.log(`watchlist ${kpis.watchlistCovered}/${kpis.watchlistTotal} covered; dossier ${(dossier.length / 1024).toFixed(0)} KiB`);
