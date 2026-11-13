// Each jurisdiction's lineage is law over time: sealed, unbroken, and a version exists only because something changed on its date.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from '@effect/vitest';
import { add_days, PlainDate } from '@norbital-ai/std/date';
import { Schema } from 'effect';
import { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { stableJson } from '../src/lib/payroll_engine/foundation.ts';
import { objectValue } from '../src/lib/payroll_engine/reads.ts';

const ROOT = join(process.cwd(), 'seed/public/jurisdiction');
const read = (path: string): readonly JsonObject[] => {
	const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
	return Schema.decodeUnknownSync(Schema.Array(JsonObject))(Array.isArray(value) ? value : [value]);
};
const IDENTITY = new Set(['id', 'settings_id', 'references', 'name']);
const LIFECYCLE = new Set(['id', 'name', 'status', 'reason', 'effective_range']);
const range = (settings: JsonObject) => {
	const { from, to } = objectValue(settings.effective_range);
	return { from: String(from), to: to ?? null };
};
const versionsOf = (code: string) =>
	readdirSync(join(ROOT, code))
		.map((folder) => {
			const settings = read(join(ROOT, code, folder, 'jurisdiction_settings.json'))[0] ?? {};
			return { folder, number: Number(folder.replace('version_', '')), settings };
		})
		.toSorted((left, right) => left.number - right.number);
/** A version's law: its settings and rows without ids, citations or what any two versions differ by anyway. */
const law = (code: string, folder: string, settings: JsonObject): string => {
	const rows = readdirSync(join(ROOT, code, folder))
		.filter((file) => file !== 'jurisdiction_settings.json')
		.toSorted()
		.map((file) => {
			const own = read(join(ROOT, code, folder, file));
			const codes = new Map(
				read(join(ROOT, code, folder, 'subtotal.json')).map((row) => [row.id, row.code])
			);
			return [
				file,
				own
					.map((row) =>
						Object.fromEntries(
							Object.entries(row)
								.filter(([key]) => !IDENTITY.has(key))
								.map(([key, value]) => [
									key,
									key.endsWith('subtotal_id') || key === 'previous_id'
										? (codes.get(value ?? '') ?? value)
										: value
								])
						)
					)
					.toSorted((left, right) => String(left.code).localeCompare(String(right.code)))
			];
		});
	return stableJson({
		settings: Object.fromEntries(Object.entries(settings).filter(([key]) => !LIFECYCLE.has(key))),
		rows
	});
};

describe('jurisdiction lineage', () => {
	for (const code of readdirSync(ROOT)) {
		const versions = versionsOf(code);
		it(`${code}: numbered in date order, sealed, unbroken and open-ended at the last`, () => {
			assert.deepEqual(
				versions.map((version) => version.number),
				versions.map((_, index) => index + 1)
			);
			for (const version of versions) assert.equal(version.settings.status, 'SEALED');
			for (const [index, version] of versions.entries()) {
				const next = versions[index + 1];
				const { to } = range(version.settings);
				if (next === undefined) assert.equal(to, null);
				else assert.equal(add_days(PlainDate(String(to)), 1), range(next.settings).from);
			}
		});

		it(`${code}: every version changes something on its date`, () => {
			for (const [index, version] of versions.entries()) {
				const before = versions[index - 1];
				if (before === undefined) continue;
				assert.notEqual(
					law(code, version.folder, version.settings),
					law(code, before.folder, before.settings),
					`${code} ${version.folder} repeats ${before.folder}`
				);
			}
		});

		it(`${code}: every subtotal chain is linear`, () => {
			for (const { folder } of versions) {
				const rows = read(join(ROOT, code, folder, 'subtotal.json'));
				const previous = rows.map((row) => row.previous_id ?? null);
				assert.equal(previous.filter((id) => id === null).length, 1, `${code} ${folder}`);
				assert.equal(new Set(previous).size, previous.length, `${code} ${folder}`);
			}
		});
	}
});
