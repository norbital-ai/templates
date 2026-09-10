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
import { readFileSync, readdirSync } from 'node:fs';
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

/**
 * Every collection this template authors, read from the tree rather than listed.
 *
 * The lists this file used to carry named five representations and six pages. `shift_definitions`
 * and `shift_patterns` were offering `company_id` on a scoped page and neither list said so,
 * because neither was on a list — which is the failure mode of an audit whose subject is written
 * down by hand. A collection added tomorrow is checked by enumerating them here.
 */
const collections = readdirSync(fileURLToPath(new URL('src/collections', templateRoot)), {
	withFileTypes: true
})
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort();

const collectionSource = (name: string, file: string): string | null => {
	try {
		return source(`src/collections/${name}/${file}`);
	} catch {
		return null;
	}
};

/** A `<Field name="x" …>`, with whatever attributes it carries. */
const fieldsNamed = (text: string, column: string): string[] =>
	[...text.matchAll(/<Field\b[^>]*?\/?>/g)]
		.map((match) => match[0])
		.filter((tag) => new RegExp(`name="${column}"`).test(tag));

test('a catalogue predicate reaches its version under a quantifier', () => {
	for (const relation of ['leave_catalogue_settings', 'payment_catalogue_settings'] as const) {
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
	assert.equal(inForceCatalogue('payment_catalogue_settings', undefined), undefined);
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
		'src/apps/hr_controller/events/+leave.svelte',
		'src/apps/hr_controller/events/+loans.svelte',
		'src/apps/hr_controller/events/+claims.svelte',
		'src/apps/hr_controller/events/+allowances.svelte',
		'src/apps/hr_controller/events/+payments.svelte',
		'src/apps/hr_controller/events/+work.svelte'
	]) {
		const text = source(page);
		assert.match(
			text,
			/setContext(<[^>]*>)?\(\s*HR_CREATE_SCOPE/,
			`${page} does not provide the create scope`
		);
	}
	for (const representation of [
		'src/collections/leave_entries/+representation.svelte',
		'src/collections/loans/+representation.svelte',
		'src/collections/claim_requests/+representation.svelte',
		'src/collections/allowance_requests/+representation.svelte',
		'src/collections/payment_requests/+representation.svelte'
	]) {
		const text = source(representation);
		assert.match(text, /hrCreateScope\(\)/, `${representation} does not read the create scope`);
		assert.match(
			text,
			/employmentRelationOptions\(/,
			`${representation} does not narrow its employment picker`
		);
		// The type picker is narrowed through the eligibility component, which applies the in-force
		// clause and then the person's own rule; a form that hands it no lineage offers every version.
		assert.match(
			text,
			/<EligibleTypes[\s\S]*?settingsCode=\{[^}]+\}/,
			`${representation} does not narrow its catalogue picker`
		);
	}
	assert.match(source('src/lib/ui/eligible-types.svelte'), /inForceCatalogue\(/);
	assert.match(
		source('src/collections/work_days/+representation.svelte'),
		/employmentRelationOptions\(/
	);
});

test('no representation offers a column its page scope already decides', () => {
	// The exhaustive half of the wiring test above: every collection in the tree, not a list.
	//
	// `company_id` and `settings_id` are decided by the page — the legal-entity combobox in the app
	// header, or the settings version on screen. A form that offers them asks the operator to
	// re-choose something already chosen, and lets them choose *differently*, which writes a row into
	// an entity the page is not showing. The shape every scoped form uses is the same: read the
	// scope, hide the field when it is set, and offer it when it is not, so an unscoped form still
	// works.
	const failures: string[] = [];
	for (const name of collections) {
		const model = collectionSource(name, '+model.ts');
		const representation = collectionSource(name, '+representation.svelte');
		if (model == null || representation == null) continue;
		for (const column of ['company_id', 'settings_id'] as const) {
			if (!new RegExp(`\\b${column}:`).test(model)) continue;
			const tags = fieldsNamed(representation, column);
			if (tags.length === 0) continue;
			// Never offered at all is stronger than offered-when-unscoped: a form that drives the
			// column from its own control hides every one of its tags. Either shape passes.
			if (tags.every((tag) => /\bhidden\b/.test(tag))) continue;
			if (!/hrCreateScope\(\)/.test(representation))
				failures.push(`${name} offers ${column} without reading the page scope`);
			else if (!tags.some((tag) => /\bhidden\b/.test(tag)))
				failures.push(`${name} offers ${column} with no hidden branch for a scoped page`);
		}
	}
	assert.deepEqual(failures, []);
});

test('no representation asks for a scoped column with a control of its own', () => {
	// The rule above reads `<Field name="company_id">`, and the payroll run form did not use one: it
	// hid the Field and drove it from a `Combobox` of its own, writing through `form.setValues`. So
	// the page was scoped to one legal entity, its table was filtered by that entity, and the form
	// in front of it asked again — an operator who answered differently built a run for an entity
	// the table does not show.
	//
	// A form may still own the control; what it may not do is own it without reading the scope.
	const failures: string[] = [];
	for (const name of collections) {
		const model = collectionSource(name, '+model.ts');
		const representation = collectionSource(name, '+representation.svelte');
		if (model == null || representation == null) continue;
		for (const column of ['company_id', 'settings_id'] as const) {
			if (!new RegExp(`\\b${column}:`).test(model)) continue;
			const writes = new RegExp(`setValues\\(\\{[^}]*\\b${column}\\b`).test(representation);
			if (writes && !/hrCreateScope\(\)/.test(representation))
				failures.push(`${name} writes ${column} from its own control without reading the scope`);
		}
	}
	assert.deepEqual(failures, []);
});

test('every employment picker is narrowed to the page entity', () => {
	// An unnarrowed employment picker offers every person in the workspace, in every entity. It is
	// the same fault as the catalogue picker and it is invisible until a second entity is seeded.
	const failures: string[] = [];
	for (const name of collections) {
		const representation = collectionSource(name, '+representation.svelte');
		if (representation == null) continue;
		if (fieldsNamed(representation, 'employment_id').length === 0) continue;
		if (!/employmentRelationOptions\(/.test(representation))
			failures.push(`${name} offers an unnarrowed employment picker`);
	}
	assert.deepEqual(failures, []);
});

test('every page that draws a scoped collection provides the scope', () => {
	// The other half: a form can only read a scope a page sets. A page that draws a table of a
	// company-scoped collection and sets nothing puts an unscoped form behind a scoped table.
	// A form that reads the scope is a form that expects one. A page drawing it and setting nothing
	// is the half of the wiring that fails silently — the picker quietly widens back out.
	const scoped = new Set(
		collections.filter((name) => {
			const representation = collectionSource(name, '+representation.svelte');
			return representation != null && /hrCreateScope\(\)/.test(representation);
		})
	);
	const pages = [
		...readdirSync(fileURLToPath(new URL('src/apps', templateRoot)), { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith('.svelte'))
			.map((entry) => `src/apps/${entry.name}`),
		...readdirSync(fileURLToPath(new URL('src/apps/hr_controller', templateRoot)), {
			withFileTypes: true
		})
			.filter((entry) => entry.isFile() && entry.name.endsWith('.svelte'))
			.map((entry) => `src/apps/hr_controller/${entry.name}`),
		...readdirSync(fileURLToPath(new URL('src/apps/hr_controller/events', templateRoot)), {
			withFileTypes: true
		})
			.filter((entry) => entry.isFile() && entry.name.endsWith('.svelte'))
			.map((entry) => `src/apps/hr_controller/events/${entry.name}`)
	];
	const failures: string[] = [];
	for (const page of pages) {
		const text = source(page);
		const drawn = [...text.matchAll(/collection="([a-z_]+)"/g)].map((match) => match[1]!);
		const scopedDrawn = drawn.filter((name) => scoped.has(name));
		if (scopedDrawn.length === 0) continue;
		if (!/setContext(<[^>]*>)?\(\s*HR_CREATE_SCOPE/.test(text))
			failures.push(`${page} draws ${scopedDrawn.join(', ')} without providing the create scope`);
	}
	// A representation drawing another collection's table is a page for that collection's forms, and
	// owes them the same scope. The person profile draws contracts, terms and statutory facts.
	for (const name of collections) {
		const representation = collectionSource(name, '+representation.svelte');
		if (representation == null) continue;
		const drawn = [...representation.matchAll(/collection="([a-z_]+)"/g)]
			.map((match) => match[1]!)
			.filter((child) => child !== name && scoped.has(child));
		if (drawn.length === 0) continue;
		if (!/setContext(<[^>]*>)?\(\s*HR_CREATE_SCOPE/.test(representation))
			failures.push(`${name} draws ${drawn.join(', ')} without providing the create scope`);
	}
	assert.deepEqual(failures, []);
});

test('the scope key is a symbol, so nothing can collide with it by name', () => {
	assert.equal(typeof HR_CREATE_SCOPE, 'symbol');
	assert.equal(HR_CREATE_SCOPE.description, 'norbital_hr.create_scope');
});
