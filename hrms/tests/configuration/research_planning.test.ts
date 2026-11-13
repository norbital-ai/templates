// What research reports becomes dated patches of the law, deterministically: one patch per date, read against the law
// as it stands on that date, with what cannot be a patch skipped and what has no date left for a person.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Change } from '../../src/lib/dated.ts';
import type { JsonObject } from '../../src/lib/payroll_engine/contracts.ts';
import {
	instrumentKey,
	officialSource,
	planChanges,
	referenceSources,
	sortFindings,
	WHOLE_ROW,
	type DatedPatch,
	type ReportedChange
} from '../../src/lib/payroll_engine/statutory_research.ts';

const FAMILY = 'statutory_contribution_catalog';
const scheme = (lookup: JsonObject): JsonObject => ({ [FAMILY]: { EPF: { lookup } } });
/** A law of two schemes and a leave row, and one later change to the first scheme's table. */
const chain: readonly Change[] = [
	{
		id: 'base',
		effective_from: '2026-01-01',
		patch: {
			lookup: { ceiling: 100 },
			subtotal: { BASIC: {} },
			[FAMILY]: {
				EPF: { employee_amount: 1, lookup: { rate: 1, floor: 10 } },
				SOCSO: { employee_amount: 2 }
			},
			leave_catalog: { ANNUAL: { days: 12 } }
		}
	},
	{ id: 'later', effective_from: '2027-07-01', patch: scheme({ rate: 3, floor: 20 }) }
];
const plan = (
	reported: readonly ReportedChange[],
	held: { readonly drafted?: readonly DatedPatch[]; readonly known?: readonly DatedPatch[] } = {},
	family = FAMILY
) =>
	planChanges({
		family,
		chain,
		drafted: held.drafted ?? [],
		known: held.known ?? [],
		reported
	});
const step = (
	field: 'rate' | 'floor',
	new_value: number,
	effective_from: string | null
): ReportedChange => ({
	row_code: 'EPF',
	field_path: `lookup.${field}`,
	new_value,
	effective_from
});

describe('statutory research planning', () => {
	it('dates a patch on the law and carries the whole field as the law holds it on that date', () => {
		assert.deepEqual(plan([step('rate', 2, '2026-12-01')]).planned, [
			{ effective_from: '2026-12-01', law: scheme({ rate: 2, floor: 10 }) }
		]);
		assert.deepEqual(plan([step('rate', 4, '2027-08-01')]).planned, [
			{ effective_from: '2027-08-01', law: scheme({ rate: 4, floor: 20 }) }
		]);
	});

	it('answers the same patches whatever order the changes arrive in', () => {
		const reported = [
			step('rate', 5, '2027-03-01'),
			step('rate', 2, '2026-12-01'),
			{
				row_code: 'SOCSO',
				field_path: 'employee_amount',
				new_value: 3,
				effective_from: '2026-12-01'
			}
		];
		assert.deepEqual(plan(reported).planned, plan(reported.toReversed()).planned);
	});

	it('makes one patch per effective date', () => {
		const { planned } = plan([
			step('rate', 2, '2027-01-01'),
			{
				row_code: 'EPF',
				field_path: 'employee_amount',
				new_value: 2,
				effective_from: '2027-01-01'
			},
			{
				row_code: 'SOCSO',
				field_path: 'employee_amount',
				new_value: 3,
				effective_from: '2027-06-01'
			}
		]);
		assert.deepEqual(planned, [
			{
				effective_from: '2027-01-01',
				law: { [FAMILY]: { EPF: { lookup: { rate: 2, floor: 10 }, employee_amount: 2 } } }
			},
			{ effective_from: '2027-06-01', law: { [FAMILY]: { SOCSO: { employee_amount: 3 } } } }
		]);
	});

	it('keeps undated law undated: no patch, and the change is named for a person to date', () => {
		for (const date of [null, 'next year']) {
			const { planned, undated } = plan([step('rate', 2, date)]);
			assert.deepEqual(planned, []);
			assert.equal(undated.length, 1);
		}
	});

	it('drops what the law already holds on the date, a later change included', () => {
		assert.equal(plan([step('rate', 1, '2026-12-01')]).planned.length, 0);
		assert.equal(plan([step('rate', 3, '2027-08-01')]).planned.length, 0);
		assert.equal(plan([step('rate', 3, null)]).planned.length, 0);
	});

	it('dedupes against what research already filed, by value and date', () => {
		const known = [{ effective_from: '2026-12-01', law: scheme({ rate: 2, floor: 10 }) }];
		assert.equal(plan([step('rate', 2, '2026-12-01')], { known }).planned.length, 0);
		assert.equal(plan([step('rate', 2, null)], { known }).planned.length, 0);
		assert.equal(plan([step('rate', 2, '2026-12-15')], { known }).planned.length, 1);
	});

	it('reports the same value twice for a date as one change', () => {
		const { planned, proposed, skipped } = plan([
			step('rate', 2, '2026-12-01'),
			step('rate', 2, '2026-12-01')
		]);
		assert.equal(planned.length, 1);
		assert.equal(proposed.length, 1);
		assert.equal(skipped.length, 1);
	});

	it('chains dated steps: a later step reads the finding’s earlier ones, until the law itself changes', () => {
		assert.deepEqual(
			plan([step('floor', 11, '2027-03-01'), step('rate', 2, '2026-12-01')]).planned,
			[
				{ effective_from: '2026-12-01', law: scheme({ rate: 2, floor: 10 }) },
				{ effective_from: '2027-03-01', law: scheme({ rate: 2, floor: 11 }) }
			]
		);
		const drafted = [{ effective_from: '2026-12-01', law: scheme({ rate: 2, floor: 10 }) }];
		assert.deepEqual(plan([step('floor', 11, '2027-03-01')], { drafted }).planned, [
			{ effective_from: '2027-03-01', law: scheme({ rate: 2, floor: 11 }) }
		]);
		assert.deepEqual(plan([step('floor', 21, '2027-08-01')], { drafted }).planned, [
			{ effective_from: '2027-08-01', law: scheme({ rate: 3, floor: 21 }) }
		]);
	});

	it('skips what cannot be a patch: an unknown row, a date not after the law’s first change, a row’s code or place in the chain, an unsafe path', () => {
		for (const change of [
			{ ...step('rate', 2, '2026-12-01'), row_code: 'NOPE' },
			step('rate', 2, '2025-01-01'),
			step('rate', 2, '2026-01-01'),
			{ ...step('rate', 2, '2026-12-01'), field_path: 'code', new_value: 'KWSP' },
			{ ...step('rate', 2, '2026-12-01'), field_path: 'previous', new_value: 'BASIC' },
			{ ...step('rate', 2, '2026-12-01'), field_path: '__proto__.x' }
		]) {
			const { planned, skipped } = plan([change]);
			assert.deepEqual(planned, [], change.field_path);
			assert.equal(skipped.length, 1, change.field_path);
		}
	});

	it('adds, removes and edits by exact declared paths', () => {
		const on = '2027-01-01';
		assert.deepEqual(
			plan([
				{ row_code: 'EPF', field_path: 'lookup.new_key', new_value: 5, effective_from: on },
				{ row_code: 'EPF', field_path: 'lookup.floor', new_value: null, effective_from: on },
				// a value of the law's own blocks names no row
				{ row_code: null, field_path: 'lookup.ceiling', new_value: 200, effective_from: on }
			]).planned,
			[
				{
					effective_from: on,
					law: { ...scheme({ rate: 1, new_key: 5 }), lookup: { ceiling: 200 } }
				}
			]
		);
		// a row is added without its code, naming its subtotal by code, and removed by null
		assert.deepEqual(
			plan(
				[
					{
						row_code: 'SICK',
						field_path: WHOLE_ROW,
						new_value: { code: 'SICK', days: 3, subtotal: 'BASIC' },
						effective_from: on
					},
					{ row_code: 'ANNUAL', field_path: WHOLE_ROW, new_value: null, effective_from: on }
				],
				{},
				'leave_catalog'
			).planned,
			[
				{
					effective_from: on,
					law: { leave_catalog: { SICK: { days: 3, subtotal: 'BASIC' }, ANNUAL: null } }
				}
			]
		);
	});

	it('recognises official hosts only over https', () => {
		for (const url of [
			'https://www.bpjs-kesehatan.go.id/a',
			'https://www.kwsp.gov.my/b',
			'https://www.cpf.gov.sg/c',
			'https://www.mhlw.go.jp/d',
			'https://www.irs.gov/e'
		])
			assert.equal(officialSource(url), true);
		for (const url of ['http://kwsp.gov.my/a', 'https://example.com', 'not a url'])
			assert.equal(officialSource(url), false);
	});

	it('keys an instrument however it is spelled', () => {
		assert.equal(instrumentKey('Act No. 452/1991'), instrumentKey('act no 452 1991'));
		assert.equal(instrumentKey('労働基準法 第32条'), '労働基準法-第32条');
	});

	it('merges repeats, keeps decisions and flags what no family holds', () => {
		const reported = {
			instrument: 'Act 1/2027',
			title: 'T',
			fit: 'VALUE' as const,
			families: ['leave_catalog'],
			source_urls: ['https://a.gov.my/1']
		};
		const fresh = sortFindings(
			[reported, { ...reported, instrument: 'act 1 2027', families: ['claim_catalog'] }],
			[]
		).fresh;
		assert.equal(fresh.length, 1);
		assert.deepEqual(fresh[0]?.families, ['leave_catalog', 'claim_catalog']);
		assert.equal(
			sortFindings([{ ...reported, families: ['visa'] }], []).fresh[0]?.fit,
			'STRUCTURAL'
		);
		const on_file = {
			id: 'f1',
			instrument_key: 'act-1-2027',
			status: 'PROPOSED',
			source_urls: ['https://b.gov.my/2']
		};
		assert.deepEqual(sortFindings([reported], [on_file]).merged, [
			['f1', ['https://b.gov.my/2', 'https://a.gov.my/1']]
		]);
		for (const status of ['REJECTED', 'CONFIRMED'])
			assert.deepEqual(sortFindings([reported], [{ ...on_file, status }]), {
				fresh: [],
				merged: [],
				decided: ['act-1-2027']
			});
	});

	it('opens sources from citations: official hosts active, others for a person', () => {
		const rows = [
			{ references: [{ title: 'A', url: 'https://www.cpf.gov.sg/a' }, { title: 'B' }] },
			{ references: [{ title: 'C', url: 'https://www.cpf.gov.sg/c' }] },
			{ references: [{ title: 'D', url: 'https://vanban.chinhphu.vn/d' }] },
			{ references: [{ title: 'E', url: 'https://web.archive.org/e' }] },
			{ references: [{ title: 'F', url: 'https://www.mom.gov.sg/f' }] }
		];
		assert.deepEqual(
			referenceSources(rows, ['https://www.mom.gov.sg']).map((row) => [row.url, row.status]),
			[
				['https://www.cpf.gov.sg', 'ACTIVE'],
				['https://vanban.chinhphu.vn', 'PROPOSED']
			]
		);
	});
});
