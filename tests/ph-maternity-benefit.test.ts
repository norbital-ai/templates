// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import casesCollection from '../src/data/collection/benefit_cases/+collection.ts';
import monthsCollection from '../src/data/collection/contribution_statement_months/+collection.ts';
import { calculateBenefitCandidate } from '../src/lib/benefit-cases/benefit.ts';
import { caller, query, transform } from './helpers/bodies.ts';
import {
	lineageTables,
	MATERNITY,
	SOLO_PARENT_ID,
	soloParentFile
} from './fixtures/benefit-cases.ts';

const months = Array.from({ length: 12 }, (_, offset) => ({
	scheme_code: 'SSS',
	coverage_month: `${offset < 6 ? 2025 : 2026}-${String(((offset + 6) % 12) + 1).padStart(2, '0')}`,
	credited_amount: 0,
	paid_on: null as string | null,
	source_reference: 'SSS statement 2026-06-30'
}));
const paid = (index: number, credited_amount: number, paid_on = '2026-06-30') =>
	months.map((row, i) => (i === index ? { ...row, credited_amount, paid_on } : row));
/** A case of the PH maternity type: its event, and whether the solo-parent extension is claimed. */
const birth = (event_kind = 'BIRTH', facts = { solo_parent_claimed: false }) => ({
	event_kind,
	event_on: '2026-10-05',
	facts: event_kind === 'BIRTH' ? facts : {}
});
const candidate = (history, benefit_case = birth(), evidence = []) =>
	calculateBenefitCandidate({ case_type: MATERNITY, benefit_case, evidence, months: history });

test('PH SSS maternity uses three paid months before the contingency semester and six highest MSCs', () => {
	const history = paid(0, 20_000)
		.map((row, i) => (i === 1 ? { ...row, credited_amount: 15_000, paid_on: '2025-08-31' } : row))
		.map((row, i) => (i === 2 ? { ...row, credited_amount: 10_000, paid_on: '2025-09-30' } : row));
	const result = candidate(history);
	assert.deepEqual(result.qualifying_window, { from: '2025-07', through: '2026-06' });
	assert.equal(result.window_closes_on, '2026-07-01');
	assert.equal(result.paid_months, 3);
	// (20,000 + 15,000 + 10,000) ÷ 180 = 250 a day × 105 days, priced by the phase's stored award.
	assert.deepEqual(
		result.phases.map((phase) => [phase.code, phase.days, phase.award]),
		[['MATERNITY', 105, 26_250]]
	);
	assert.equal(result.candidate_benefit, 26_250);
	assert.equal(
		candidate([...history, { ...history[0]!, coverage_month: '2025-06' }]).candidate_benefit,
		26_250
	);
	// A month paid on the close does not count: two paid months are short of the stored three.
	const short = candidate(
		history.map((row, i) => (i === 2 ? { ...row, paid_on: '2026-07-01' } : row))
	);
	assert.equal(short.paid_months, 2);
	assert.equal(short.candidate_benefit, 0);
});

test('PH case SSS candidate reads saved member history and refuses unproved solo-parent extension', async () => {
	const history = paid(0, 20_000)
		.map((row, i) => (i === 1 ? { ...row, credited_amount: 15_000, paid_on: '2025-08-31' } : row))
		.map((row, i) => (i === 2 ? { ...row, credited_amount: 10_000, paid_on: '2025-09-30' } : row))
		.map((row) => ({ ...row, employee_id: 'mother' }));
	const caseRow = {
		id: 'case-1',
		employee_id: 'mother',
		employment_id: 'contract',
		case_type: 'MATERNITY_LEAVE',
		application_on: '2026-09-01',
		event_kind: 'BIRTH',
		event_on: '2026-10-05',
		facts: { solo_parent_claimed: false }
	};
	const ask = (record: typeof caseRow, ledger: typeof history = history, evidence = []) =>
		query(
			casesCollection,
			'credit_candidate',
			{ case_id: 'case-1' },
			caller({
				tables: {
					...lineageTables(),
					benefit_cases: [record],
					fact_evidence: evidence,
					contribution_statement_months: [
						...ledger,
						{ ...ledger[0]!, coverage_month: '2025-06' },
						{ ...ledger[0]!, employee_id: 'other' }
					]
				}
			})
		);
	const result = await ask(caseRow);
	assert.equal(result.candidate_benefit, 26_250);
	assert.equal(result.status, 'CANDIDATE_NOT_AWARD');
	await assert.rejects(ask(caseRow, history.slice(1)), /all 12 SSS contribution months/);
	await assert.rejects(
		ask({ ...caseRow, facts: { solo_parent_claimed: true } }),
		/event-valid LGU document evidence/
	);
	const solo = { ...caseRow, facts: SOLO_PARENT_ID };
	assert.equal((await ask(solo, history, [soloParentFile()])).candidate_benefit, 30_000);
	await assert.rejects(ask(solo), /event-valid LGU document evidence/);
	await assert.rejects(
		ask(
			{ ...solo, facts: { ...SOLO_PARENT_ID, solo_parent_document_valid_through: '2026-10-04' } },
			history,
			[soloParentFile()]
		),
		/event-valid LGU document evidence/
	);
});

test('PH benefit distinguishes 105, 120 and 60 days and caps at six regular MSCs', () => {
	const history = months.map((row, i) =>
		i < 7 ? { ...row, credited_amount: 20_000 - 2_000 * i, paid_on: '2026-06-30' } : row
	);
	const documented = [soloParentFile()];
	// The six highest of seven: 20,000 + 18,000 + … + 10,000 = 90,000 ÷ 180 × 105.
	assert.equal(candidate(history).candidate_benefit, 52_500);
	assert.equal(
		candidate(history, birth('BIRTH', SOLO_PARENT_ID), documented).candidate_benefit,
		60_000
	);
	assert.equal(candidate(history, birth('MISCARRIAGE')).candidate_benefit, 30_000);
	assert.equal(candidate(history, birth('EMERGENCY_TERMINATION')).candidate_benefit, 30_000);
	assert.throws(
		() =>
			candidate(history, {
				...birth('MISCARRIAGE'),
				facts: { solo_parent_claimed: true }
			}),
		/solo-parent days/
	);
	// The regular credit is capped at the case type's PHP 20,000.
	assert.throws(
		() =>
			candidate(
				months.map((row, i) =>
					i === 0 ? { ...row, credited_amount: 20_500, paid_on: '2026-06-30' } : row
				)
			),
		/monthly credit is 0–20000/
	);
});

test('PH benefit refuses missing or duplicate history and preserves January quarter boundaries', () => {
	assert.throws(() => candidate(months.slice(1)), /all 12/);
	assert.throws(() => candidate([...months.slice(0, 11), months[0]!]), /duplicate/i);
	assert.deepEqual(
		candidate(
			months.map((row, index) => ({
				...row,
				coverage_month: `${index < 3 ? 2024 : 2025}-${String(((index + 9) % 12) + 1).padStart(2, '0')}`
			})),
			{ ...birth(), event_on: '2026-01-01' }
		).qualifying_window,
		{ from: '2024-10', through: '2025-09' }
	);
});

test('PH SSS statement rows require payment evidence and separate regular MSC', async () => {
	const row = {
		employee_id: 'mother',
		scheme_code: 'SSS',
		coverage_month: '2025-07',
		credited_amount: '20000.00',
		paid_on: '2025-07-31',
		source_reference: 'SSS paid statement 2025-07'
	};
	await transform(monthsCollection, [row]);
	for (const [change, message] of [
		[{ credited_amount: '20000.001' }, /to the cent/],
		[{ paid_on: null }, /unpaid contribution month/],
		[{ source_reference: ' ' }, /statement reference/],
		[{ coverage_month: '2025-13' }, /coverage month/],
		[{ scheme_code: '' }, /names its scheme/]
	] as const)
		await assert.rejects(transform(monthsCollection, [{ ...row, ...change }]), message);
});
