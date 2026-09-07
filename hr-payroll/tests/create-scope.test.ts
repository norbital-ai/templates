/**
 * The scope a page hands down to the forms it opens.
 *
 * The `ANNUAL_LEAVE`-five-times bug was entirely this being absent. An operator page is scoped to
 * one legal entity by the combobox in its header, and the tables it draws are filtered by that —
 * but a representation is a shared component with no page above it, so the *forms* behind those
 * tables were not. Their relation pickers offered every employment in the workspace and every
 * version of every catalogue lineage. Five `ANNUAL_LEAVE` rows were never duplicate data; they
 * were five versions of one lineage, offered because nothing narrowed them.
 *
 * Two things need pinning, and they need pinning here rather than in a browser:
 *
 * 1. **The predicate shape.** `inForceCatalogue` reaches the version through a relation, and a
 *    relation may only enter a `where` under a quantifier — naming the related column directly is
 *    read as a field and refused at decode time, which is how a page dies rather than showing an
 *    empty table (`tests/predicate-grammar.test.ts`). That scanner reads source text and **cannot
 *    see this one**, because the relation is a computed key: `{ [relation]: … }`. The blind spot
 *    is real and this test is what covers it.
 *
 * 2. **The wiring.** A representation that stops reading the scope, or a page that stops setting
 *    it, silently restores the old unnarrowed behaviour — no error, no empty state, just every
 *    version of everything back in the picker.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	employmentRelationOptions,
	inForceCatalogue,
	HR_CREATE_SCOPE
} from '../src/lib/ui/create-scope.ts';
import { inForceSettings } from '../src/lib/ui/settings-scope.ts';

const templateRoot = new URL('../', import.meta.url);
const source = (path: string): string =>
	readFileSync(fileURLToPath(new URL(path, templateRoot)), 'utf8');

const QUANTIFIERS = new Set(['some', 'none', 'every']);

test('a catalogue predicate reaches its version under a quantifier', () => {
	for (const relation of ['leave_catalogue_settings', 'component_catalogue_settings'] as const) {
		const predicate = inForceCatalogue(relation, 'PUB', '2026-03-10');
		assert.ok(predicate !== undefined, `${relation} produced no predicate for a scoped page`);
		const keys = Object.keys(predicate);
		assert.deepEqual(keys, [relation], `the predicate names one relation: ${JSON.stringify(keys)}`);
		const branch = predicate[relation] as Record<string, unknown>;
		const quantifier = Object.keys(branch);
		assert.equal(
			quantifier.length,
			1,
			`a relation takes exactly one quantifier: ${JSON.stringify(quantifier)}`
		);
		assert.ok(
			QUANTIFIERS.has(quantifier[0] ?? ''),
			`${relation} is filtered by "${quantifier[0]}", which the predicate grammar reads as a ` +
				'field operator and refuses at decode time'
		);
		// And what it quantifies is the engine's own in-force pick, not a second opinion about it.
		assert.deepEqual(branch.some, inForceSettings('PUB', '2026-03-10'));
	}
});

test('an unscoped page narrows nothing rather than showing nothing', () => {
	// A form opened outside a scoped page — a finder result, a link — must keep working. Returning
	// an empty predicate instead of `undefined` would filter the picker down to nothing at all.
	assert.equal(inForceCatalogue('leave_catalogue_settings', undefined), undefined);
	assert.equal(inForceCatalogue('component_catalogue_settings', undefined), undefined);
	const unscoped = employmentRelationOptions(undefined);
	assert.equal(
		Object.hasOwn(unscoped, 'where'),
		false,
		'an unscoped employment picker must carry no filter at all'
	);
});

test('a scoped page narrows people to its own entity', () => {
	const scoped = employmentRelationOptions('11111111-1111-4111-8111-111111111111');
	assert.deepEqual(scoped.where, {
		company_id: { eq: '11111111-1111-4111-8111-111111111111' }
	});
	// The picker searches what it loaded, so a page-sized limit would hide people from search
	// rather than paginate to them. The ceiling is deliberate.
	assert.equal(scoped.limit, 10_000);
});

test('every controller page sets the scope, and every form it opens reads it', () => {
	// A symbol context has no runtime trace to assert from outside a component, so the wiring is
	// read from source. Both halves are checked: a page that stops providing it and a form that
	// stops consuming it fail the same way — silently, back to every version of everything.
	for (const page of [
		'src/apps/hr_controller/+leave.svelte',
		'src/apps/hr_controller/+loans.svelte',
		'src/apps/hr_controller/events/+claims.svelte',
		'src/apps/hr_controller/events/+allowances.svelte',
		'src/apps/hr_controller/events/+bonuses.svelte',
		'src/apps/hr_controller/events/+arrears.svelte',
		'src/apps/hr_controller/events/+corrections.svelte'
	]) {
		const text = source(page);
		assert.match(
			text,
			/setContext(<[^>]*>)?\(\s*HR_CREATE_SCOPE/,
			`${page} does not provide the create scope`
		);
	}
	for (const representation of [
		'src/collections/leave_requests/+representation.svelte',
		'src/collections/loans/+representation.svelte',
		'src/collections/claim_requests/+representation.svelte',
		'src/collections/allowance_requests/+representation.svelte',
		'src/collections/bonus_requests/+representation.svelte',
		'src/collections/arrears_requests/+representation.svelte',
		'src/collections/correction_requests/+representation.svelte'
	]) {
		const text = source(representation);
		assert.match(text, /hrCreateScope\(\)/, `${representation} does not read the create scope`);
		assert.match(
			text,
			/employmentRelationOptions\(/,
			`${representation} does not narrow its employment picker`
		);
		assert.match(
			text,
			/inForceCatalogue\(/,
			`${representation} does not narrow its catalogue picker`
		);
	}
});

test('the scope key is a symbol, so nothing can collide with it by name', () => {
	assert.equal(typeof HR_CREATE_SCOPE, 'symbol');
	assert.equal(HR_CREATE_SCOPE.description, 'norbital_hr.create_scope');
});
