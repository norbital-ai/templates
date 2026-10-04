import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as Predicate from 'effect/Predicate';
import type { SeedSource } from '@norbital-ai/bolt';

type Row = Record<string, unknown>;

/**
 * Parse each collection row separately from bytes, so a large collection never needs one whole-file string.
 * Structural bytes are ASCII and UTF-8 continuation bytes are never ASCII, so byte scanning is exact.
 */
function parseRows(bytes: Buffer, path: string): Row[] {
 const rows: Row[] = [];
 let start = -1, depth = 0, quoted = false, escaped = false, opened = false, ended = false;
 let position: 'first' | 'value' | 'separator' = 'first';
 for (let cursor = 0; cursor < bytes.length; cursor++) {
  const char = bytes[cursor];
  if (start < 0) {
   if (char === 32 || char === 9 || char === 10 || char === 13) continue;
   if (!opened) { if (char !== 91) throw new Error(`Seed collection must be an array: ${path}`); opened = true; continue; }
   if (ended) throw new Error(`Seed collection has trailing data: ${path}`);
   if (position === 'separator') {
    if (char === 44) { position = 'value'; continue; }
    if (char === 93) { ended = true; continue; }
    throw new Error(`Seed collection requires a row separator: ${path}`);
   }
   if (char === 93 && position === 'first') { ended = true; continue; }
   if (char !== 123) throw new Error(`Seed rows must be objects: ${path}`);
   start = cursor; depth = 1; continue;
  }
  if (quoted) { if (escaped) escaped = false; else if (char === 92) escaped = true; else if (char === 34) quoted = false; continue; }
  if (char === 34) quoted = true;
  else if (char === 123 || char === 91) depth++;
  // repository-health:allow R6b -- the generic seed loader has no collection schema; rows are admitted by the engine's per-collection contracts after this build-time parse.
  else if (char === 125 || char === 93) { if (--depth === 0) { rows.push(JSON.parse(bytes.subarray(start, cursor + 1).toString('utf8'))); start = -1; position = 'separator'; } }
 }
 if (!opened || !ended || start >= 0) throw new Error(`Seed collection is incomplete: ${path}`);
 return rows;
}

/** One plain `<collection>.json`. */
export function readRows(path: string): Row[] {
 return parseRows(readFileSync(path), path);
}

/** One gzipped `<collection>.json.gz` — the form a collection over the host's authored-text ceiling takes. */
export function readRowsCompressed(path: string): Row[] {
 return parseRows(gunzipSync(readFileSync(path)), path);
}

/**
 * A snapshot row may carry `behaviours.programs_from: <sibling row id>` instead of its own copy of the immutable
 * programme registry: identical bodies live once in that sibling's `programs`, while every row keeps its own
 * `program_refs`. Expansion here restores exactly the registry the row would have carried.
 */
function shareProgramLibraries(rows: Record<string, Row[]>): void {
 for (const list of Object.values(rows)) {
  const byId = new Map<string, Row>();
  for (const row of list) if (Predicate.isString(row['id'])) byId.set(row['id'], row);
  for (const row of list) {
   const value = row['behaviours'];
   if (!Predicate.isObject(value)) continue;
   if (!Predicate.isObject(value)) continue;
   const from = value['programs_from'];
   if (!Predicate.isString(from)) continue;
   const held = byId.get(from)?.['behaviours'];
   if (!Predicate.isObject(held) || held['programs'] === undefined) throw new Error(`Seed programme library is absent: ${from}`);
   value['programs'] = held['programs'];
   delete value['programs_from'];
  }
 }
}

export default {
 bank: 'norbital_hr',
 rows(bank) {
  const rows: Record<string, Row[]> = {};
  const law = [new URL('./jurisdiction/', import.meta.url), new URL('../../seed/jurisdiction/', import.meta.url)].map(url => fileURLToPath(url)).find(candidate => existsSync(candidate));
  if (law === undefined) throw new Error('Jurisdiction seed data is absent.');
  if (!existsSync(law)) throw new Error(`Jurisdiction seed data is absent: ${law}`);
  for (const lineage of readdirSync(law, {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => entry.name).toSorted()) {
   const directory = `${law}${lineage}`;
   const files = readdirSync(directory, {withFileTypes: true}).filter(entry => entry.isFile()).map(entry => entry.name).toSorted();
   const plain = new Set(files.filter(file => /^[a-z_]+\.json$/.test(file)).map(file => file.slice(0, -'.json'.length)));
   for (const file of files) {
    const name = /^([a-z_]+)\.json(\.gz)?$/.exec(file);
    if (!name) continue;
    if (name[2] === '.gz' && plain.has(name[1]!)) continue;
    const target = rows[name[1]!] ??= [];
    for (const row of name[2] === '.gz' ? readRowsCompressed(`${directory}/${file}`) : readRows(`${directory}/${file}`)) target.push(row);
   }
  }
  for (const entity of ['kdit', 'opsph', 'nihon', 'norbital', 'opssg', 'global']) {
   for (const file of bank.files(`records/${entity}`)) {
    const name = /\/([a-z_]+)\.json$/.exec(file)?.[1];
    if (name) { const target = rows[name] ??= []; for (const row of bank.json<Row[]>(file)) target.push(row); }
   }
  }
  shareProgramLibraries(rows);
  return rows as never;
 },
 start: []
} satisfies SeedSource;
