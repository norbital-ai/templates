// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Every lineage's seeded history is one clean line: no voided version, each version cloned from
 * the one before it, ranges that tile without a gap or an overlap, no two neighbours equal in
 * content (one sealed version = one change in the law), and every child row under a version that
 * exists.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { stableJson } from '../src/lib/jurisdiction_settings.ts';

const ROOT = new URL('../seed/jurisdiction/', import.meta.url);
const read = (url: URL) => {
	const bytes = readFileSync(url);
	return JSON.parse((url.pathname.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8'));
};
/** What a version says apart from its identity, period, seal and prose. */
const META = new Set([
	'id',
	'name',
	'sealed_at',
	'voided_at',
	'void_reason',
	'cloned_from_id',
	'effective_range',
	'change_summary',
	'sources'
]);
const withoutProse = (value: unknown): unknown =>
	Array.isArray(value)
		? value.map(withoutProse)
		: value != null && typeof value === 'object'
			? Object.fromEntries(
					Object.entries(value)
						.filter(([key]) => key !== 'authority' && key !== 'sources')
						.map(([key, member]) => [key, withoutProse(member)])
				)
			: value;

for (const lineage of readdirSync(ROOT, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)) {
	const dir = new URL(`${lineage}/`, ROOT);
	const versions = read(new URL('jurisdiction_settings.json', dir));
	const children = readdirSync(dir)
		.filter((file) => /\.json(\.gz)?$/.test(file) && !file.startsWith('jurisdiction_settings'))
		.map((file) => [file, read(new URL(file, dir))] as const);
	const ordered = versions.toSorted((a, b) =>
		a.effective_range.start.localeCompare(b.effective_range.start)
	);

	test(`${lineage}: no version is voided and every version is sealed`, () => {
		assert.deepEqual(
			versions.filter((v) => v.voided_at != null || v.void_reason != null).map((v) => v.id),
			[]
		);
		assert.deepEqual(
			versions.filter((v) => v.sealed_at == null).map((v) => v.id),
			[]
		);
	});

	test(`${lineage}: ranges tile without a gap or an overlap`, () => {
		for (const [index, version] of ordered.entries()) {
			const { start, end } = version.effective_range;
			assert.ok(end == null || start < end, `${version.id} ends before it starts`);
			const next = ordered[index + 1];
			if (next != null) assert.equal(end, next.effective_range.start, `${version.id} → ${next.id}`);
		}
	});

	test(`${lineage}: each version is cloned from the one before it`, () => {
		assert.deepEqual(
			ordered.map((v) => v.cloned_from_id ?? null),
			[null, ...ordered.slice(0, -1).map((v) => v.id)]
		);
	});

	test(`${lineage}: no two neighbouring versions say the same thing`, () => {
		const content = (version) =>
			stableJson({
				version: withoutProse(
					Object.fromEntries(Object.entries(version).filter(([key]) => !META.has(key)))
				),
				children: children.map(([file, rows]) => [
					file,
					rows
						.filter((row) => row.settings_id === version.id)
						.map(({ id, settings_id, effective_range, ...rest }) => stableJson(withoutProse(rest)))
						.toSorted()
				])
			});
		for (const [index, version] of ordered.slice(1).entries())
			assert.notEqual(
				content(version),
				content(ordered[index]),
				`${version.id} changes nothing from ${ordered[index].id}`
			);
	});

	test(`${lineage}: every row sits under a version that exists`, () => {
		const ids = new Set(versions.map((v) => v.id));
		for (const [file, rows] of children)
			assert.deepEqual(
				rows.filter((row) => !ids.has(row.settings_id)).map((row) => row.id),
				[],
				file
			);
	});
}
