import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { Schema } from 'effect';
import { fileURLToPath } from 'node:url';
import type { SeedSource } from '@norbital-ai/bolt';
import { formatSeedRow } from './cel.js';
import { overtimeRule } from './overtime_policies.js';

type Json = Schema.Json;
type SeedRows = Awaited<ReturnType<SeedSource['rows']>>;
type Row = { [field: string]: Json };
const isRecord = Schema.is(Schema.Record(Schema.String, Schema.Json));

/** A bank row in the collection's current shape: a roster day's overtime and incentive derive from its clock past the
 * planned shift, so the hours the bank typed are not read. */
export const bankRow = (collection: string, row: Row): Row => {
	if (collection !== 'roster_entry') return row;
	const { approved_overtime_hours: _approved, incentive_hours: _incentive, ...day } = row;
	return day;
};

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
		const seed = [new URL('./', import.meta.url), new URL('../../seed/', import.meta.url)]
			.map((url) => fileURLToPath(url))
			.find((candidate) => existsSync(`${candidate}jurisdiction/`));
		if (seed === undefined) throw new Error('Jurisdiction seed data is absent.');
		const law = `${seed}jurisdiction/`;
		// The public bank-format catalogue: verified upload layouts an entity selects for its paying account.
		rows['bank'] = readRows(`${seed}bank.json`);
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
		for (const settings of rows['jurisdiction_settings'] ?? []) {
			if (
				(rows['rule_set'] ?? []).some(
					(row) =>
						row['settings_id'] === settings['id'] &&
						row['family'] === 'PAYROLL' &&
						row['code'] === 'overtime_classification'
				)
			)
				continue;
			const policy = overtimeRule(settings);
			if (policy !== null) (rows['rule_set'] ??= []).push(policy);
		}
		// The private sample: `records/<entity>/<collection>.json`, rows already in the current collection shape. For now
		// every validation of a sample entity only warns, as a new entity's does. Of the system files only members load:
		// teams and their grants are source declarations.
		for (const file of bank.files('records')) {
			const collection = /^records\/[a-z0-9_]+\/([a-z_]+)\.json$/.exec(file)?.[1];
			if (collection === undefined || (collection.startsWith('sys_') && collection !== 'sys_user'))
				continue;
			(rows[collection] ??= []).push(
				...bank
					.json<Row[]>(file)
					.map((row) =>
						collection === 'entity'
							? { validation_severity: { default: 'warn', rules: {} }, ...row }
							: bankRow(collection, row)
					)
			);
		}
		// Each sample entity observes the holidays its bank rows chose for the years they cover; later years come from
		// its jurisdiction's gazetted `public_holidays` (national, or regional where the entity's region is named),
		// published on 1 December of the year before, as the bank's own rows are.
		const lawHolidays = new Map<string, Map<string, Row>>();
		for (const settings of rows['jurisdiction_settings'] ?? []) {
			const lineage = settings['jurisdiction_code'];
			const calendar = (rows['rule_set'] ?? []).find(
				(row) =>
					row['settings_id'] === settings['id'] &&
					row['family'] === 'PAYROLL' &&
					row['code'] === 'public_holidays'
			)?.['rules'];
			const listed = isRecord(calendar) ? calendar['holidays'] : undefined;
			if (!isString(lineage) || !Array.isArray(listed)) continue;
			const byDate = lawHolidays.get(lineage) ?? new Map<string, Row>();
			for (const holiday of listed)
				if (isRecord(holiday) && isString(holiday['date'])) byDate.set(holiday['date'], holiday);
			lawHolidays.set(lineage, byDate);
		}
		for (const entity of rows['entity'] ?? []) {
			const company = entity['id'];
			const lineage = entity['settings_code'];
			if (!isString(company) || !isString(lineage)) continue;
			const held = (rows['holiday'] ?? []).filter((row) => row['company_id'] === company);
			const covered = held
				.flatMap((row) => (isString(row['date']) ? [row['date'].slice(0, 4)] : []))
				.reduce((last, year) => (year > last ? year : last), '');
			for (const [date, holiday] of lawHolidays.get(lineage) ?? []) {
				const regions = holiday['regions'];
				if (
					date.slice(0, 4) <= covered ||
					(Array.isArray(regions) && !regions.includes(entity['region'] ?? ''))
				)
					continue;
				const hash = createHash('sha256')
					.update(`norbital_hr:holiday:${company}:${date}`)
					.digest('hex');
				(rows['holiday'] ??= []).push({
					id: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
					company_id: company,
					date,
					name: holiday['name'] ?? '',
					kind: holiday['kind'] ?? 'PUBLIC_HOLIDAY',
					given_to: holiday['given_to'] ?? 'EVERYONE',
					...(isString(holiday['replaces']) ? { replaces: holiday['replaces'] } : {}),
					published_at: `${Number.parseInt(date.slice(0, 4), 10) - 1}-12-01T00:00:00.000Z`
				});
			}
		}
		const settings = rows['jurisdiction_settings'] ?? [];
		const settingsIds = new Set(
			settings.flatMap((row) => (isString(row['id']) ? [row['id']] : []))
		);
		for (const row of settings) {
			const from = row['cloned_from_id'];
			if (isString(from) && !settingsIds.has(from)) delete row['cloned_from_id'];
		}
		return Object.fromEntries(
			Object.entries(rows).map(([collection, entries]) => [
				collection,
				entries.map((row) => formatSeedRow(collection, row))
			])
		) satisfies SeedRows;
	},
	start: []
} satisfies SeedSource;
