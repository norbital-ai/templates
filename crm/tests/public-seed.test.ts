import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadPublicSeed } from '@norbital-ai/test-utilities';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const seedDirectory = join(packageRoot, 'tests/fixtures/seed');

type SeedStageGroup =
	| { readonly kind: 'one'; readonly name: string }
	| { readonly kind: 'many'; readonly names: readonly string[] };

type TemplateManifest = {
	readonly seed?: {
		readonly stages?: unknown;
	};
};

const normalizeStageGroup = (value: unknown, index: number): SeedStageGroup => {
	if (typeof value === 'string') return { kind: 'one', name: value };
	if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
		return { kind: 'many', names: value };
	}
	throw new Error(`norbital.template.json seed.stages[${index}] is not a stage group`);
};

const flattenSeedStages = (groups: readonly SeedStageGroup[]): readonly string[] => {
	const stages: string[] = [];
	for (const group of groups) {
		switch (group.kind) {
			case 'one':
				stages.push(group.name);
				break;
			case 'many':
				stages.push(...group.names);
				break;
			default: {
				const _exhaustive: never = group;
				throw new Error(`unhandled seed stage group: ${JSON.stringify(_exhaustive)}`);
			}
		}
	}
	return stages;
};

const insertedCollection = (statement: string): string => {
	const match = /^INSERT INTO "([^"]+)"/.exec(statement);
	assert.ok(match?.[1], `expected INSERT INTO, got ${statement}`);
	return match[1];
};

test('loadPublicSeed inserts invented crm fixture rows through query', async () => {
	const manifest = JSON.parse(
		readFileSync(join(packageRoot, 'norbital.template.json'), 'utf8')
	) as TemplateManifest;
	const stages = flattenSeedStages((manifest.seed?.stages ?? []).map(normalizeStageGroup));
	assert.ok(stages.includes('accounts'));
	assert.ok(stages.includes('products'));
	assert.ok(stages.includes('contacts'));

	const calls: Array<{ readonly statement: string; readonly parameters: readonly unknown[] }> = [];
	await loadPublicSeed({
		stages,
		rows: seedDirectory,
		query: async (statement, parameters) => {
			calls.push({ statement, parameters: [...(parameters ?? [])] });
		}
	});

	assert.deepEqual(
		calls.map((call) => insertedCollection(call.statement)),
		['accounts', 'products', 'contacts']
	);
	assert.ok(calls.some((call) => call.parameters.includes('PUB-ACC-0001')));
	assert.ok(calls.some((call) => call.parameters.includes('PUB-PRD-0001')));
	assert.ok(calls.some((call) => call.parameters.includes('PUB-CON-0001')));
});
