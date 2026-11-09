// The ID contract and case gates: a PKWT must be evidenced in Indonesian, a work-injury leave can only raise a report
// from a real dated slot, and WLKP annual reports run from a recorded/fulfilled establishment report.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';

type Rule = {
	readonly code: string;
	readonly condition?: string;
	readonly validate?: string;
	readonly effects?: string;
	readonly lookup?: Record<string, unknown>;
};
const rule = (file: string, code: string) => {
	const row = (
		JSON.parse(
			readFileSync(
				new URL(`../seed/public/jurisdiction/ID/version_3/${file}`, import.meta.url),
				'utf8'
			)
		) as readonly Rule[]
	).find((item) => item.code === code);
	assert.ok(row !== undefined);
	return row;
};
const contract = (term: string | null, written?: boolean) => ({
	engagement: 'EMPLOYEE',
	effective_range: { from: '2025-01-01', to: null },
	signed_contract_period: term === null ? null : { from: term, to: '2026-12-31' },
	employee_extension_data: written === undefined ? {} : { written_in_indonesian: written }
});

const pkwt = rule('registered_rule.json', 'PKWT_WRITTEN_INDONESIAN');
const applicable = (entry: object) =>
	evaluate(pkwt.condition!, 'CALCULATION', { lookup: pkwt.lookup ?? {}, entry }, pkwt.code);
const written = (entry: object) =>
	evaluate(pkwt.validate!, 'CALCULATION', { lookup: pkwt.lookup ?? {}, entry }, pkwt.code);

const accident = rule('registered_effect.json', 'WORK_ACCIDENT_REPORT');
const injury = (slots: readonly object[]) =>
	evaluate(
		accident.effects!,
		'CALCULATION',
		{
			lookup: accident.lookup ?? {},
			entry: { id: 'leave-1', entity_id: 'entity-1', employment_id: 'contract-1' },
			reads: {
				obligation: [],
				leave_catalog: [{ code: 'WORK_ACCIDENT_LEAVE' }],
				leave_catalog_entry_day: slots
			}
		},
		accident.code
	) as readonly { due_on: string }[];

const wlkp = rule('registered_effect.json', 'WLKP_ANNUAL_REPORT');
const profile = (reported: string | null, from = '2026-01-01') => ({
	status: 'SEALED',
	effective_range: { from, to: null },
	entity_extension_data: reported === null ? {} : { wlkp_first_reported_on: reported }
});
const wlkpHolds = (
	coverage: string,
	versions: readonly object[],
	obligation: readonly object[] = []
) =>
	evaluate(
		wlkp.condition!,
		'CALCULATION',
		{
			lookup: wlkp.lookup ?? {},
			entry: { entity_id: 'entity-1', salary_coverage: { from: coverage, to: coverage } },
			reads: { entity_profile_version: versions, obligation }
		},
		wlkp.code
	);

describe('ID remaining contract and case gates', () => {
	it('a fixed term is accepted only with an Indonesian written agreement', () => {
		assert.equal(applicable(contract('2026-01-01', true)), true);
		assert.equal(written(contract('2026-01-01', true)), true);
		assert.equal(written(contract('2026-01-01')), false);
		assert.equal(written(contract('2026-01-01', false)), false);
		assert.equal(applicable(contract(null)), false);
	});
	it('a work-injury leave with no dated slot raises no report', () => {
		assert.equal(injury([]).length, 0);
		const dated = injury([{ incurred_on: '2026-06-01', part: 'AM' }]);
		assert.equal(dated.length, 1);
		assert.equal(dated[0]?.due_on, '2026-06-03');
	});
	it('WLKP reports only after a recorded or fulfilled first report', () => {
		assert.equal(wlkpHolds('2027-02-01', [profile('2026-01-15')]), true);
		assert.equal(wlkpHolds('2026-02-01', [profile('2026-01-15')]), false);
		assert.equal(wlkpHolds('2027-02-01', [profile(null)]), false);
		const key = evaluate(
			"return occurrence_key(['ID', 'WLKP_ESTABLISHMENT_REPORT', ctx.entry.entity_id, 'ESTABLISHMENT', '2026-01-01']);",
			'CALCULATION',
			{ entry: { entity_id: 'entity-1' } },
			'key'
		);
		assert.equal(
			wlkpHolds('2027-02-01', [profile(null)], [
				{ occurrence_key: key, state: 'FULFILLED', fulfilled_on: '2026-02-01' }
			]),
			true
		);
	});
});
