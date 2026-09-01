// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const modelSource = readFileSync(
	new URL('../collections/jurisdictions/+model.ts', import.meta.url),
	'utf8'
);
const representationSource = readFileSync(
	new URL('../collections/jurisdictions/+representation.svelte', import.meta.url),
	'utf8'
);

function jurisdictionFields(): readonly string[] {
	const definition = modelSource.match(
		/export default defineModel\(\s*\{(?<fields>[\s\S]*?)\n\s*\},\s*\n\s*\{/
	)?.groups?.fields;
	assert.ok(definition, 'jurisdictions model must retain a readable top-level field definition');
	return [...definition.matchAll(/^\s*([a-z][a-z0-9_]*)\s*:/gm)].map((match) => match[1]);
}

function declaredFormFields(): readonly string[] {
	return [...representationSource.matchAll(/<Field\s+name="([a-z][a-z0-9_]*)"(?:\s|\/>)/g)].map(
		(match) => match[1]
	);
}

test('the jurisdiction CollectionForm declares every mutable field exactly once', () => {
	const declared = declaredFormFields();
	for (const field of jurisdictionFields()) {
		assert.equal(
			declared.filter((candidate) => candidate === field).length,
			1,
			`jurisdictions.${field} must be rendered or explicitly hidden exactly once`
		);
	}
});

test('lifecycle-only jurisdiction fields stay hidden and server-governed', () => {
	for (const field of ['successor_profile_id', 'void_reason']) {
		assert.match(
			representationSource,
			new RegExp(`<Field\\s+name="${field}"\\s+hidden\\s*/>`),
			`jurisdictions.${field} must remain an explicit hidden CollectionForm field`
		);
	}
});

/**
 * The two lifecycle fields are hidden on the jurisdictions form, and the test above says so. That
 * form is not the only operator-facing surface: every app page under `src/apps` writes its own Bolt
 * query projections and its own tables, and a `columns: { void_reason: true }` there would put a
 * server-governed field back in front of an operator without touching `+representation.svelte` at
 * all. The rule H7 states is "never appears in an operator-facing form or projection", so it is
 * checked over every operator surface rather than over the one that happens to declare the model.
 */
const LIFECYCLE_ONLY_FIELDS = ['successor_profile_id', 'void_reason'];

const filesUnder = (directory) =>
	readdirSync(directory).flatMap((entry) => {
		const path = join(directory, entry);
		return statSync(path).isDirectory() ? filesUnder(path) : [path];
	});

test('no operator app surface names a lifecycle-only jurisdiction field', () => {
	const appsRoot = fileURLToPath(new URL('../apps', import.meta.url));
	const offenders = filesUnder(appsRoot).flatMap((path) => {
		const source = readFileSync(path, 'utf8');
		return LIFECYCLE_ONLY_FIELDS.filter((field) => source.includes(field)).map(
			(field) => `${path.slice(appsRoot.length + 1)} names ${field}`
		);
	});
	assert.deepEqual(offenders, []);
});

test('every collection representation but the jurisdictions form leaves them alone', () => {
	const collectionsRoot = fileURLToPath(new URL('../collections', import.meta.url));
	const offenders = filesUnder(collectionsRoot)
		.filter((path) => path.endsWith('+representation.svelte'))
		.filter((path) => !path.includes(`${join('collections', 'jurisdictions')}`))
		.flatMap((path) => {
			const source = readFileSync(path, 'utf8');
			return LIFECYCLE_ONLY_FIELDS.filter((field) => source.includes(field)).map(
				(field) => `${path.slice(collectionsRoot.length + 1)} names ${field}`
			);
		});
	assert.deepEqual(offenders, []);
});
