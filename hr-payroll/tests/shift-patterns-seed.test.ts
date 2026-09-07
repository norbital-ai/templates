// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The shape the seed conversion left behind, and the surfaces that consume it.
 *
 * The public fixture is the one seed this repository can see; the bank's five entities were
 * converted by the same script and are checked by the bank's own tests. What is pinned here is the
 * contract every loader relies on: terms point at a pattern row that exists, patterns are unique
 * per company and decode as the `work_pattern` type, and the manifest stages them before the terms
 * that reference them.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { Schema } from 'effect';
import { workPatternSchema } from '../src/datatypes/work_pattern/+definition.ts';

const fixture = (name) =>
	JSON.parse(readFileSync(new URL(`./fixtures/seed/${name}.json`, import.meta.url), 'utf8'));
const manifest = JSON.parse(
	readFileSync(new URL('../norbital.template.json', import.meta.url), 'utf8')
);

test('every public term points at a pattern row of its own company, and no term embeds one', () => {
	const patterns = fixture('shift_patterns');
	const terms = fixture('employment_terms');
	const employments = new Map(fixture('employments').map((row) => [row.id, row]));
	const patternById = new Map(patterns.map((row) => [row.id, row]));
	assert.ok(patterns.length >= 1);
	for (const term of terms) {
		assert.equal('work_pattern' in term, false, `${term.id} still embeds a work pattern`);
		const pattern = patternById.get(term.shift_pattern_id);
		assert.ok(pattern, `${term.id} points at ${term.shift_pattern_id}, which is not seeded`);
		assert.equal(pattern.company_id, employments.get(term.employment_id)?.company_id);
	}
});

test('pattern rows are unique per company and code, and decode as the work_pattern type', () => {
	const patterns = fixture('shift_patterns');
	const codes = fixture('shift_definitions');
	const codeIds = new Set(codes.map((row) => row.id));
	const seen = new Set();
	for (const row of patterns) {
		const key = `${row.company_id}:${row.code}`;
		assert.equal(seen.has(key), false, `duplicate pattern ${key}`);
		seen.add(key);
		assert.ok(row.name.length > 0);
		const decoded = Schema.decodeUnknownSync(workPatternSchema)(row.pattern);
		if (decoded.type === 'PATTERNED') {
			for (const phase of decoded.phases)
				for (const day of phase.day_cycle)
					assert.ok(codeIds.has(day.roster_code_id), `${row.code} names a missing roster code`);
		}
	}
});

test('the manifest stages patterns after companies and before the terms that point at them', () => {
	const stages = manifest.seed.stages.map((stage) => [...stage]);
	const stageOf = (name) => stages.findIndex((stage) => stage.includes(name));
	assert.ok(stageOf('shift_patterns') > stageOf('companies'));
	assert.ok(stageOf('shift_patterns') < stageOf('employment_terms'));
	const collections = readdirSync(new URL('../src/collections/', import.meta.url), {
		withFileTypes: true
	}).filter((entry) => entry.isDirectory()).length;
	assert.equal(manifest.counts.collections, collections);
	assert.ok(
		readdirSync(new URL('../src/collections/shift_patterns/', import.meta.url)).length >= 2
	);
});
