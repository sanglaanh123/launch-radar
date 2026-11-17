// Launch Radar, a token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), runs the radar model in
// dashboard/model.js (the same file the page runs), and writes to /output (or MAKEFUN_OUTPUT_DIR):
//   board.json    the ranked rows, each with its implied value, the factors behind it and a farm plan
//   data.js       the snapshot as window.SNAPSHOT, which the page feeds to the same model
//   dashboard/    the static page, copied as is
//   screenshots/  the three captures, copied as is
//   dossier.json  written last by vendor/makefun-board.ts, as the scorer rebuilds it
// Nothing here reads the clock or a random source, so two runs write the same bytes.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`launch radar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory>`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

interface Protocol {
  slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number; change_7d: number | null;
  mcap_usd: number | null; listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
interface Snapshot { as_of: string; source: string; floor_usd: number; protocols: Protocol[]; watchlist: string[] }

/** The snapshot, keeping exactly the ten documented fields and refusing a shape the model cannot score. */
function readSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (typeof raw.as_of !== 'string' || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist) || typeof raw.floor_usd !== 'number') {
    fail('snapshot.json lacks as_of, floor_usd, protocols or watchlist');
  }
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' && v !== '-' ? v : null);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const protocols = (raw.protocols as Record<string, unknown>[])
    .filter((p) => typeof p.slug === 'string' && typeof p.name === 'string' && num(p.tvl_usd) !== null && (p.tvl_usd as number) > 0)
    .map((p) => ({
      slug: p.slug as string,
      name: p.name as string,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd as number,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    }));
  return { as_of: raw.as_of, source: String(raw.source ?? ''), floor_usd: raw.floor_usd, protocols, watchlist: (raw.watchlist as unknown[]).filter((s): s is string => typeof s === 'string') };
}

const snapshot = readSnapshot(readFileSync(inputFile, 'utf8'));

// The page's model, loaded into an isolated context: one implementation for the board and the screen.
const sandbox: { RadarModel?: any } = {};
runInNewContext(readFileSync(join(here, 'dashboard', 'model.js'), 'utf8'), sandbox, { filename: 'model.js' });
const RM = sandbox.RadarModel;
if (!RM) fail('dashboard/model.js did not define RadarModel');
const radar = RM.build(snapshot);

const rows = radar.rows.map((r: any) => ({
  rank: r.rank,
  slug: r.slug,
  name: r.name,
  category: r.category,
  chains: r.chains,
  scope: r.scope,
  token_status: r.token_status,
  tvl_usd: r.tvl_usd,
  change_7d: r.change_7d,
  listed_at: r.listed_at,
  implied_value_usd: r.implied_value_usd,
  model: r.model,
  farm_steps: r.plan.map((s: any) => RM.stepText(s)),
}));

// The gate's rules, checked before anything is written.
const slugs = new Set(rows.map((r: any) => r.slug));
const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
if (missing.length) fail(`board misses watchlist slugs: ${missing.slice(0, 5).join(', ')}`);
if (rows.length < 100 || rows.length > 4000) fail(`board has ${rows.length} rows, not 100 to 4000`);
rows.forEach((r: any, i: number) => {
  if (r.rank !== i + 1) fail(`row ${i} has rank ${r.rank}`);
  if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) fail(`${r.slug} implied value ${r.implied_value_usd}`);
  if (i > 0 && r.implied_value_usd > rows[i - 1].implied_value_usd) fail(`${r.slug} outranks the row above it`);
  if (r.farm_steps.length < 3 || r.farm_steps.length > 12) fail(`${r.slug} has ${r.farm_steps.length} farm steps`);
  for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) fail(`${r.slug} farm step of ${s.length} characters`);
});
if (rows[0].implied_value_usd === rows[rows.length - 1].implied_value_usd) fail('every row shares one implied value');

mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'board.json'),
  `${JSON.stringify({ as_of: snapshot.as_of, source: snapshot.source, model: radar.constants, watchlist_size: snapshot.watchlist.length, rows })}\n`,
);
writeFileSync(join(out, 'data.js'), `window.SNAPSHOT=${JSON.stringify(snapshot)};\n`);

function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from).filter((n) => !n.startsWith('.') && statSync(join(from, n)).isFile()).sort();
  for (const n of names) copyFileSync(join(from, n), join(to, n));
  return names;
}

copyDir(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyDir(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} images: hand in 3`);

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

const early = rows.filter((r: any) => r.scope === 'early').length;
process.stdout.write(`launch radar: ${rows.length} ranked (${rows.length - early} watchlist, ${early} early), ${radar.trading.length} trading, ${radar.products.length} set aside; wrote ${out}\n`);
