import assert from 'node:assert/strict';
import test from 'node:test';
import { sealNeighbours, sealWrites } from '../src/lib/settings_version_seal.ts';

const version = (id: string, start: string, end: string | null, sealed = true, voided = false) => ({
	id,
	effective_range: {
		start: `${start}T00:00:00.000Z`,
		end: end == null ? null : `${end}T00:00:00.000Z`
	},
	sealed_at: sealed ? '2026-01-01T00:00:00.000Z' : null,
	voided_at: voided ? '2026-01-02T00:00:00.000Z' : null
});

test('a draft between two sealed versions ends the one before it and takes the start of the one after', () => {
	const lineage = [
		version('v1', '2026-01-01', '2026-04-01'),
		version('v2', '2026-04-01', '2027-01-01'),
		version('v4', '2027-01-01', null),
		version('draft', '2026-05-01', null, false),
		version('voided', '2026-06-01', null, true, true)
	];
	const draft = lineage[3]!;
	assert.deepEqual(
		[sealNeighbours(draft, lineage).before?.id, sealNeighbours(draft, lineage).after?.id],
		['v2', 'v4']
	);
	assert.deepEqual(sealWrites(draft, lineage, '2026-09-20T00:00:00.000Z'), [
		{
			id: 'v2',
			effective_range: { start: '2026-04-01T00:00:00.000Z', end: '2026-05-01T00:00:00.000Z' }
		},
		{
			id: 'draft',
			effective_range: { start: '2026-05-01T00:00:00.000Z', end: '2027-01-01T00:00:00.000Z' },
			sealed_at: '2026-09-20T00:00:00.000Z'
		}
	]);
});

test('the first version of a lineage seals alone and open-ended', () => {
	const draft = version('only', '2026-01-01', null, false);
	assert.deepEqual(sealWrites(draft, [draft], '2026-09-20T00:00:00.000Z'), [
		{
			id: 'only',
			effective_range: { start: '2026-01-01T00:00:00.000Z', end: null },
			sealed_at: '2026-09-20T00:00:00.000Z'
		}
	]);
});
