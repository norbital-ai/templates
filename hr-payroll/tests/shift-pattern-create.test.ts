/**
 * A shift pattern is created from its entity's Shifts tab, a button that carries no preset: the form itself names the
 * entity, and its cycle offers that entity's shift definitions. Without the field the create submits nothing and says
 * nothing; without the definitions no day of a new pattern can be assigned.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';

const source = readFileSync(
	join(process.cwd(), 'src/data/collection/entity/shift_pattern/+representation.svelte'),
	'utf8'
);

it('the shift pattern create form names its entity', () => {
	assert.match(source, /\{#if record == null\}<Field name="company_id" \/>\{\/if\}/);
});

it('the cycle offers the definitions of the entity the form names, record or not', () => {
	assert.match(source, /record\?\.company_id \?\? form\.get\('company_id'\)/);
	assert.match(source, /\.filter\(\(row\) => row\.company_id === company\)/);
	assert.doesNotMatch(source, /record\?\.company_id == null\s*\?\s*null/);
});
