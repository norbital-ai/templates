import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { Schema } from 'effect';
import { fileURLToPath } from 'node:url';
import type { SeedSource } from '@norbital-ai/bolt';

type Json = Schema.Json;
type SeedRows = Awaited<ReturnType<SeedSource['rows']>>;
type Row = { [field: string]: Json };
const isRecord = Schema.is(Schema.Record(Schema.String, Schema.Json));

/**
 * Parse each collection row separately from bytes, so a large collection never needs one whole-file string.
 * Structural bytes are ASCII and UTF-8 continuation bytes are never ASCII, so byte scanning is exact.
 */
function parseRows(bytes: Buffer, path: string): Row[] {
	const rows: Row[] = [];
	let start = -1,
		depth = 0,
		quoted = false,
		escaped = false,
		opened = false,
		ended = false;
	let position: 'first' | 'value' | 'separator' = 'first';
	for (let cursor = 0; cursor < bytes.length; cursor++) {
		const char = bytes[cursor];
		if (start < 0) {
			if (char === 32 || char === 9 || char === 10 || char === 13) continue;
			if (!opened) {
				if (char !== 91) throw new Error(`Seed collection must be an array: ${path}`);
				opened = true;
				continue;
			}
			if (ended) throw new Error(`Seed collection has trailing data: ${path}`);
			if (position === 'separator') {
				if (char === 44) {
					position = 'value';
					continue;
				}
				if (char === 93) {
					ended = true;
					continue;
				}
				throw new Error(`Seed collection requires a row separator: ${path}`);
			}
			if (char === 93 && position === 'first') {
				ended = true;
				continue;
			}
			if (char !== 123) throw new Error(`Seed rows must be objects: ${path}`);
			start = cursor;
			depth = 1;
			continue;
		}
		if (quoted) {
			if (escaped) escaped = false;
			else if (char === 92) escaped = true;
			else if (char === 34) quoted = false;
			continue;
		}
		if (char === 34) quoted = true;
		else if (char === 123 || char === 91) depth++;
		else if (char === 125 || char === 93) {
			if (--depth === 0) {
				// repository-health:allow R6b -- the generic seed loader has no collection schema; rows are admitted by the engine's per-collection contracts after this build-time parse.
				const parsed: unknown = JSON.parse(bytes.subarray(start, cursor + 1).toString('utf8'));
				if (!isRecord(parsed)) throw new Error(`Seed row is not an object: ${path}`);
				rows.push(parsed);
				start = -1;
				position = 'separator';
			}
		} // repository-health:allow R6b -- the generic seed loader has no collection schema; rows are admitted by the engine's per-collection contracts after this build-time parse.
	}
	if (!opened || !ended || start >= 0) throw new Error(`Seed collection is incomplete: ${path}`);
	return rows;
}

/** One plain `<collection>.json`. */
export function readRows(path: string): Row[] {
	return parseRows(readFileSync(path), path);
}

const isString = Schema.is(Schema.String);
const versionIndex = (name: string): number =>
	Schema.decodeUnknownSync(Schema.NumberFromString)(name.slice('version_'.length));

export default {
	bank: 'norbital_hr',
	rows(bank) {
		const rows: { [collection: string]: Row[] } = {};
		// The bank build projects this reader into `.norbital/cache/`; beside the source it reads its own tree.
		const law = [
			new URL('./jurisdiction/', import.meta.url),
			new URL('../../seed/jurisdiction/', import.meta.url)
		]
			.map((url) => fileURLToPath(url))
			.find((candidate) => existsSync(candidate));
		if (law === undefined) throw new Error('Jurisdiction seed data is absent.');
		for (const lineage of readdirSync(law, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.toSorted()) {
			for (const version of readdirSync(`${law}${lineage}`, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
				.toSorted((left, right) => versionIndex(left) - versionIndex(right))) {
				const directory = `${law}${lineage}/${version}`;
				for (const file of readdirSync(directory, { withFileTypes: true })
					.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
					.map((entry) => entry.name)
					.toSorted()) {
					const name = file.slice(0, -'.json'.length);
					const target = (rows[name] ??= []);
					for (const row of readRows(`${directory}/${file}`)) target.push(row);
				}
			}
		}
		// The private sample: `records/<entity>/<collection>.json`, rows already in the current collection shape.
		for (const file of bank.files('records')) {
			const collection = /^records\/[a-z0-9_]+\/([a-z_]+)\.json$/.exec(file)?.[1];
			if (collection !== undefined) (rows[collection] ??= []).push(...bank.json<Row[]>(file));
		}
		const settings = rows['jurisdiction_settings'] ?? [];
		const settingsIds = new Set(
			settings.flatMap((row) => (isString(row['id']) ? [row['id']] : []))
		);
		for (const row of settings) {
			const from = row['cloned_from_id'];
			if (isString(from) && !settingsIds.has(from)) delete row['cloned_from_id'];
		}
		return rows satisfies SeedRows;
	},
	start: []
} satisfies SeedSource;
