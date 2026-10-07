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
	type ContractTerm
} from '../src/lib/payroll_engine/contract_terms.ts';

const draft = {
	start: '2020-01-15',
	salary: 4500,
	currency: 'SGD',
	employment_type: 'PERMANENT',
	residency_status: 'CITIZEN',
	work_classification: 'EA_COVERED',
	statutory_work_category: 'NON_MANUAL',
	allowances: [{ code: 'TRANSPORT', amount: 200 }]
};

describe('contract terms', () => {
	it('L-TPL-hr-payroll-032 writes the first open term onto the new contract', () => {
		const set = hireContractSet({
			employee_id: 'e1',
			company_id: 'c1',
			employee_number: 'E-12',
			draft
		});
		assert.ok(typeof set !== 'string');
		assert.equal(set.employee_number, 'E-12');
		assert.deepEqual(set.effective_range, { from: '2020-01-15', to: null });
		assert.equal(set.facts.contract_terms.length, 1);
		assert.deepEqual(set.facts.contract_terms[0]?.base_salary, { value: 4500, currency: 'SGD' });
		assert.deepEqual(set.facts.contract_terms[0]?.allowances, [
			{ code: 'TRANSPORT', amount: { value: 200 } }
		]);
	});

	it('L-TPL-hr-payroll-033 closes the predecessor the day before the successor', () => {
		const hired = hireContractSet({
			employee_id: 'e1',
			company_id: 'c1',
			employee_number: 'E-12',
			draft
		});
		assert.ok(typeof hired !== 'string');
		const changed = changeTermsSet(hired.facts.contract_terms, {
			...draft,
			start: '2024-04-01',
			salary: 5200
		});
		assert.ok(typeof changed !== 'string');
		assert.deepEqual(changed.facts.contract_terms[0]?.effective_range, {
			from: '2020-01-15',
			to: '2024-03-31'
		});
		assert.deepEqual(changed.facts.contract_terms[1]?.effective_range, {
			from: '2024-04-01',
			to: null
		});
		assert.equal(changed.facts.contract_terms[1]?.base_salary.value, 5200);
		assert.equal(
			termInForceOn(changed.facts.contract_terms, '2024-03-31')?.base_salary.value,
			4500
		);
		assert.equal(
			termInForceOn(changed.facts.contract_terms, '2024-04-01')?.base_salary.value,
			5200
		);
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
		const hired = hireContractSet({
			employee_id: 'e1',
			company_id: 'c1',
			employee_number: 'E-12',
			draft
		});
		assert.ok(typeof hired !== 'string');
		assert.equal(
			typeof changeTermsSet(hired.facts.contract_terms, {
				...draft,
				start: '2020-01-15',
				salary: 1
			}),
			'string'
		);
		assert.deepEqual(termsFromFacts(hired.facts), hired.facts.contract_terms);
	});

	it('a paid period keeps its terms: a change into it is refused, a change from the next period is accepted', () => {
		const hired = hireContractSet({
			employee_id: 'e1',
			company_id: 'c1',
			employee_number: 'E-12',
			draft
		});
		assert.ok(typeof hired !== 'string');
		const terms = hired.facts.contract_terms;
		// March 2026 is paid (a regular slip and an off-cycle slip over the same window).
		const paid = [
			{ from: '2026-03-01', to: '2026-03-31' },
			{ from: '2026-03-01', to: '2026-03-31' }
		];
		const raise = (start: string) => {
			const set = changeTermsSet(terms, { ...draft, start, salary: 5200 });
			assert.ok(typeof set !== 'string');
			return refusePaidTermsChange(hired.facts, set.facts, paid);
		};
		assert.equal(
			raise('2026-03-16'),
			'These terms are already paid through 2026-03-31. Start the change on or after 2026-04-01, or delete the payroll run that paid the period.'
		);
		assert.equal(raise('2026-04-01'), null);
		// An allowance edited in place on the open term rewrites paid March too.
		const edited = {
			contract_terms: terms.map((term) => ({
				...term,
				allowances: [{ code: 'TRANSPORT', amount: { value: 250 } }]
			}))
		};
		assert.match(String(refusePaidTermsChange(hired.facts, edited, paid)), /paid through/);
		// Deleting the run releases the period.
		assert.equal(refusePaidTermsChange(hired.facts, edited, []), null);
	});
});
