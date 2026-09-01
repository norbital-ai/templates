// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
