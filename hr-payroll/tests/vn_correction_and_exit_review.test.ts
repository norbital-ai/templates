// A contribution correction is a fund task only for a closed (paid, on-cycle) month; an open month's ordinary run
// absorbs it. The exit review reads only the exiting employment's own combining agreement, never another employee's.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';

type Row = {
	readonly code: string;
	readonly condition?: string;
	readonly effects?: string;
	readonly validate?: string;
	readonly reads?: {
		readonly workplace_case_catalog_entry?: {
			readonly where?: Record<string, unknown>;
		};
	};
};
const load = <T>(file: string): T =>
	JSON.parse(
		readFileSync(new URL(`../seed/public/jurisdiction/VN/version_7/${file}`, import.meta.url), 'utf8')
	) as T;
const effects = load<readonly Row[]>('registered_effect.json');
const rules = load<readonly Row[]>('registered_rule.json');
const correction = effects.find((row) => row.code === 'CONTRIBUTION_CORRECTION');
const exitReview = rules.find((row) => row.code === 'ANNUAL_SERVICE_EXIT_REVIEW');
assert.ok(correction?.condition !== undefined && correction.effects !== undefined);
assert.ok(exitReview?.validate !== undefined);
const catalog = load<readonly { code: string; lookup?: unknown }[]>('adhoc_catalog.json');
const siAdjustment = catalog.find((row) => row.code === 'SI_ADJUSTMENT');
const siRefund = catalog.find((row) => row.code === 'SI_REFUND');
assert.ok(siAdjustment !== undefined && siRefund !== undefined);

const correctionContext = (
	incurred_on: string,
	payroll_run: readonly object[],
	extra: { readonly reverses?: string; readonly catalog?: object } = {}
) => ({
	entry: {
		id: 'entry-1',
		entity_id: 'entity-1',
		employment_id: 'employment-1',
		quantity: 1_000_000,
		incurred_on,
		...(extra.reverses === undefined ? {} : { reverses: extra.reverses })
	},
	subject: { employment: { employee_id: 'employee-1' } },
	reads: {
		obligation: [],
		adhoc_catalog: [extra.catalog ?? siAdjustment],
		payroll_run
	},
	lookup: {}
});
const closed = [{ period: '2027-01', kind: 'ON_CYCLE', state: 'PAID' }];

describe('VN contribution correction', () => {
	it('raises a fund task only for a paid run of the corrected month', () => {
		const condition = (context: object) =>
			evaluate(correction!.condition!, 'CALCULATION', context, 'correction');
		assert.equal(condition(correctionContext('2027-01-15', closed)), true);
		assert.equal(condition(correctionContext('2027-01-15', [])), false);
		assert.equal(condition(correctionContext('2027-02-15', closed)), false);
		assert.equal(condition(correctionContext('2027-01-15', closed, { reverses: 'original' })), false);
		const noAccounts = { code: 'SI_ADJUSTMENT', lookup: { accounts: [] } };
		assert.equal(condition(correctionContext('2027-01-15', closed, { catalog: noAccounts })), false);
	});
	it('titles arrears and refunds with the catalogue code', () => {
		const result = (row: object) =>
			evaluate(correction!.effects!, 'CALCULATION', correctionContext('2027-01-15', closed, { catalog: row }), 'correction') as readonly { title: string }[];
		assert.equal(result(siAdjustment)[0]?.title, 'Pay 1000000 in arrears to the fund: SI_ADJUSTMENT');
		assert.equal(result(siRefund)[0]?.title, 'Claim 1000000 back from the fund: SI_REFUND');
	});
});

const contract = (review: object | null) => ({
	id: 'employment-a',
	entity_id: 'entity-1',
	effective_range: { from: '2025-01-01', to: '2027-03-31' },
	employee_extension_data: review === null ? {} : { annual_leave_service_review: review }
});
const agreement = (employment_id: string, from: string, to: string) => ({
	opened_on: '2027-01-01',
	closed_on: null,
	inputs: { employment_id, effective_from: from, effective_to: to }
});
const review = { year: '2027', as_of: '2027-03-31', reference: 'personnel file' };
const validate = (entry: object, cases: readonly object[]) =>
	evaluate(
		exitReview!.validate!,
		'CALCULATION',
		{ entry, reads: { workplace_case_catalog_entry: cases }, lookup: {} },
		'exit review'
	);

describe('VN annual-service exit review', () => {
	it('reads only the exiting employment and entity', () => {
		const where = exitReview!.reads?.workplace_case_catalog_entry?.where ?? {};
		assert.deepEqual(where['kind'], { eq: 'ANNUAL_LEAVE_COMBINING_AGREEMENT' });
		assert.deepEqual(where['employment_id'], { eq: { var: 'ctx.entry.id' } });
		assert.deepEqual(where['entity_id'], { eq: { var: 'ctx.entry.entity_id' } });
	});
	it('with no agreement in the scoped read the exit passes', () => {
		assert.equal(validate(contract(review), []), true);
	});
	it('the exiting employee\u2019s own agreement demands the carry fields', () => {
		const own = [agreement('employment-a', '2027-01-01', '2027-12-31')];
		assert.equal(validate(contract(review), own), false);
		assert.equal(
			validate(contract({ ...review, carry_previous_year_days: 2, carry_second_previous_year_days: 1 }), own),
			true
		);
	});
	it('an agreement that does not cover the exit date is not a combining agreement for it', () => {
		assert.equal(
			validate(contract(review), [agreement('employment-a', '2028-01-01', '2028-12-31')]),
			true
		);
	});
});
