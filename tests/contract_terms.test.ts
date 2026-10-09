/** L-TPL-hr-payroll-032 hire; L-TPL-hr-payroll-033 change terms; L-TPL-hr-payroll-036 no overlapping terms. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PlainDate } from '@norbital-ai/std/date';
import {
	changeTermsSet,
	hireContractSet,
	refusePaidTermsChange,
	refuseTermsOverlap,
	termInForceOn,
	termsFromFacts,
	salaryOf,
	type ContractTerm
} from '../src/lib/payroll_engine/contract_terms.ts';
import { missingRequired, requiredOf } from '../src/lib/ui/person/input_schema.ts';

const values = {
	base_salary: { value: 4500, currency: 'SGD' },
	currency: 'SGD',
	employment_type: 'PERMANENT',
	residency_status: 'CITIZEN',
	work_classification: 'EA_COVERED',
	statutory_work_category: 'NON_MANUAL',
	facts: { mom_declared_monthly_salary: 4500 }
};
const allowances = [{ code: 'TRANSPORT', amount: 200 }];
const hire = (overrides: object = {}) => {
	const set = hireContractSet({
		employee_id: 'e1',
		company_id: 'c1',
		employee_number: 'E-12',
		start: '2020-01-15',
		values,
		allowances,
		...overrides
	});
	assert.ok(typeof set !== 'string');
	return set;
};

describe('contract terms', () => {
	it('L-TPL-hr-payroll-032 writes the first open term onto the new contract', () => {
		const set = hire();
		assert.equal(set.employee_number, 'E-12');
		assert.deepEqual(set.effective_range, { from: '2020-01-15', to: null });
		assert.equal(set.facts.contract_terms.length, 1);
		const [term] = set.facts.contract_terms;
		assert.deepEqual(salaryOf(term!), { value: 4500, currency: 'SGD' });
		assert.deepEqual(term?.allowances, [{ code: 'TRANSPORT', amount: { value: 200 } }]);
		assert.equal(typeof term?.id, 'string');
		// Nothing is defaulted: an unset key is absent, never a date or a code source chose.
		assert.equal('residency_since' in term!, false);
		assert.equal(
			'residency_since' in
				hire({ values: { ...values, residency_since: '' } }).facts.contract_terms[0]!,
			false
		);
	});

	it('L-TPL-hr-payroll-033 closes the predecessor the day before the successor, carrying every key', () => {
		const hired = hire();
		const stored = hired.facts.contract_terms.map((term) => ({
			...term,
			employment_id: 'k1',
			allowances: [
				{ code: 'TRANSPORT', catalogue_id: 'a1', amount: { value: 200, currency: 'SGD' } }
			]
		}));
		const [current] = termsFromFacts({ contract_terms: stored });
		const changed = changeTermsSet(termsFromFacts({ contract_terms: stored }), {
			start: '2024-04-01',
			values: { ...current!, base_salary: { value: 5200, currency: 'SGD' } },
			allowances: [{ code: 'TRANSPORT', amount: 250, source: stored[0]!.allowances[0]! }]
		});
		assert.ok(typeof changed !== 'string');
		const [closed, next] = changed.facts.contract_terms;
		assert.deepEqual(closed?.effective_range, { from: '2020-01-15', to: '2024-03-31' });
		assert.deepEqual(next?.effective_range, { from: '2024-04-01', to: null });
		// The closed term is the stored one, its id and facts kept; the successor carries every key under a new id.
		assert.equal(closed?.id, stored[0]!.id);
		assert.deepEqual(closed?.facts, values.facts);
		assert.notEqual(next?.id, closed?.id);
		for (const key of ['facts', 'currency', 'statutory_work_category', 'employment_id'] as const)
			assert.deepEqual(next?.[key], closed?.[key], key);
		assert.deepEqual(next?.allowances, [
			{ code: 'TRANSPORT', catalogue_id: 'a1', amount: { value: 250, currency: 'SGD' } }
		]);
		assert.equal(salaryOf(termInForceOn(changed.facts.contract_terms, '2024-03-31')!)?.value, 4500);
		assert.equal(salaryOf(termInForceOn(changed.facts.contract_terms, '2024-04-01')!)?.value, 5200);
	});

	it('L-TPL-hr-payroll-036 refuses overlapping terms and admits a closed successor', () => {
		const overlap: ContractTerm = {
			effective_range: { from: PlainDate('2020-01-01'), to: null },
			base_salary: { value: 1, currency: 'SGD' },
			allowances: []
		};
		const other: ContractTerm = {
			effective_range: { from: PlainDate('2021-01-01'), to: null },
			base_salary: { value: 2, currency: 'SGD' },
			allowances: []
		};
		assert.equal(refuseTermsOverlap([overlap, other]), 'Employment terms cannot overlap.');
		const hired = hire();
		assert.equal(
			typeof changeTermsSet(hired.facts.contract_terms, {
				start: '2020-01-15',
				values,
				allowances: []
			}),
			'string'
		);
		assert.deepEqual(termsFromFacts(hired.facts), hired.facts.contract_terms);
	});

	it('a paid period keeps its whole term: a change into it is refused, a change from the next period is accepted', () => {
		const hired = hire();
		const terms = hired.facts.contract_terms;
		// March 2026 is paid (a regular slip and an off-cycle slip over the same window).
		const paid = [
			{ from: '2026-03-01', to: '2026-03-31' },
			{ from: '2026-03-01', to: '2026-03-31' }
		];
		const raise = (start: string) => {
			const set = changeTermsSet(terms, {
				start,
				values: { ...terms[0]!, base_salary: { value: 5200, currency: 'SGD' } },
				allowances
			});
			assert.ok(typeof set !== 'string');
			return refusePaidTermsChange(hired.facts, set.facts, paid);
		};
		assert.equal(
			raise('2026-03-16'),
			'These terms are already paid through 2026-03-31. Start the change on or after 2026-04-01, or delete the payroll run that paid the period.'
		);
		assert.equal(raise('2026-04-01'), null);
		const edit = (change: (term: ContractTerm) => ContractTerm) => ({
			contract_terms: terms.map(change)
		});
		// An allowance, a fact or a declared key edited in place on the open term rewrites paid March too.
		for (const edited of [
			edit((term) => ({ ...term, allowances: [{ code: 'TRANSPORT', amount: { value: 250 } }] })),
			edit((term) => ({ ...term, facts: { mom_declared_monthly_salary: 9000 } })),
			edit((term) => ({ ...term, statutory_work_category: 'MANUAL_LABOUR' })),
			edit(({ facts: _facts, ...term }) => term)
		])
			assert.match(String(refusePaidTermsChange(hired.facts, edited, paid)), /paid through/);
		// Deleting the run releases the period.
		assert.equal(
			refusePaidTermsChange(
				hired.facts,
				edit((term) => term),
				[]
			),
			null
		);
	});

	it('the input schema decides what is required, including a key another value requires', () => {
		const node = {
			type: 'object',
			required: ['residency_status'],
			properties: {
				residency_status: { type: 'string', enum: ['CITIZEN', 'PERMANENT_RESIDENT'] },
				residency_since: { type: 'string', format: 'date' },
				facts: { type: 'object', required: ['days'], properties: { days: { type: 'number' } } }
			},
			allOf: [
				{
					if: { properties: { residency_status: { const: 'PERMANENT_RESIDENT' } } },
					then: { required: ['residency_since'] }
				}
			]
		};
		assert.deepEqual(requiredOf(node, { residency_status: 'CITIZEN' }), ['residency_status']);
		assert.deepEqual(missingRequired(node, {}), ['residency_status', 'facts.days']);
		assert.deepEqual(
			missingRequired(node, { residency_status: 'PERMANENT_RESIDENT', facts: { days: 5 } }),
			['residency_since']
		);
		assert.deepEqual(
			missingRequired(node, {
				residency_status: 'PERMANENT_RESIDENT',
				residency_since: '2020-01-01',
				facts: { days: 5 }
			}),
			[]
		);
	});
});
