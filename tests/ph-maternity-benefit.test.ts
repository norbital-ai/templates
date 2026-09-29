import assert from 'node:assert/strict';
import test from 'node:test';
import casesCollection from '../src/data/collection/ph_maternity_cases/+collection.ts';
import monthsCollection from '../src/data/collection/sss_contribution_months/+collection.ts';
import { calculateSssMaternityBenefit } from '../src/lib/ph/maternity-benefit.ts';
import { caller, query, transform } from './helpers/bodies.ts';

const months = Array.from({ length: 12 }, (_, offset) => ({
	coverage_month: `${offset < 6 ? 2025 : 2026}-${String(((offset + 6) % 12) + 1).padStart(2, '0')}`,
	regular_msc: 0,
	paid_on: null as string | null,
	source_reference: 'SSS statement 2026-06-30'
}));
const paid = (index: number, regular_msc: number, paid_on = '2026-06-30') =>
	months.map((row, i) => (i === index ? { ...row, regular_msc, paid_on } : row));

test('PH SSS maternity uses three paid months before the contingency semester and six highest MSCs', () => {
	const history = paid(0, 20_000)
		.map((row, i) => (i === 1 ? { ...row, regular_msc: 15_000, paid_on: '2025-08-31' } : row))
		.map((row, i) => (i === 2 ? { ...row, regular_msc: 10_000, paid_on: '2025-09-30' } : row));
	const result = calculateSssMaternityBenefit({
		contingency_date: '2026-10-05',
		contingency: 'BIRTH',
		solo_parent: false,
		months: history
	});
	assert.deepEqual(result.qualifying_window, { from: '2025-07', through: '2026-06' });
	assert.equal(result.semester_from, '2026-07-01');
	assert.equal(result.paid_months, 3);
	assert.equal(result.contribution_qualified, true);
	assert.equal(result.total_msc, 45_000);
	assert.equal(result.adsc, 250);
	assert.equal(result.candidate_benefit, 26_250);
	assert.equal(
		calculateSssMaternityBenefit({
			contingency_date: '2026-10-05',
			contingency: 'BIRTH',
			solo_parent: false,
			months: [...history, { ...history[0]!, coverage_month: '2025-06' }]
		}).candidate_benefit,
		26_250
	);
	assert.equal(
		calculateSssMaternityBenefit({
			contingency_date: '2026-10-05',
			contingency: 'BIRTH',
			solo_parent: false,
			months: history.map((row, i) => (i === 2 ? { ...row, paid_on: '2026-07-01' } : row))
		}).contribution_qualified,
		false
	);
});

test('PH case SSS candidate reads saved member history and refuses unproved solo-parent extension', async () => {
	const history = paid(0, 20_000)
		.map((row, i) => (i === 1 ? { ...row, regular_msc: 15_000, paid_on: '2025-08-31' } : row))
		.map((row, i) => (i === 2 ? { ...row, regular_msc: 10_000, paid_on: '2025-09-30' } : row))
		.map((row) => ({ ...row, employee_id: 'mother' }));
	const caseRow = {
		id: 'case-1',
		employee_id: 'mother',
		event_kind: 'BIRTH',
		event_on: '2026-10-05',
		solo_parent_claimed: false
	};
	const ask = (record: typeof caseRow, ledger: typeof history = history) =>
		query(
			casesCollection,
			'sss_candidate',
			{ case_id: 'case-1' },
			caller({
				tables: {
					ph_maternity_cases: [record],
					sss_contribution_months: [
						...ledger,
						{ ...ledger[0]!, coverage_month: '2025-06' },
						{ ...ledger[0]!, employee_id: 'other' }
					]
				}
			})
		);
	const candidate = await ask(caseRow);
	assert.equal(candidate.candidate_benefit, 26_250);
	assert.equal(candidate.status, 'CANDIDATE_NOT_SSS_AWARD');
	await assert.rejects(ask(caseRow, history.slice(1)), /all twelve/);
	await assert.rejects(
		ask({ ...caseRow, solo_parent_claimed: true }),
		/event-valid LGU document evidence/
	);
	const solo = {
		...caseRow,
		solo_parent_claimed: true,
		solo_parent_document_kind: 'SOLO_PARENT_ID',
		solo_parent_document_issued_on: '2026-08-01',
		solo_parent_document_valid_from: '2026-08-01',
		solo_parent_document_valid_through: '2027-07-31',
		solo_parent_document_reference: 'LGU-SP-001',
		solo_parent_document_issuer_lgu: 'City LGU',
		solo_parent_document_file: { path: 'solo-parent-id.pdf' },
		solo_parent_social_worker_signature_seen: true,
		solo_parent_mayor_signature_seen: true
	};
	assert.equal((await ask(solo)).candidate_benefit, 30_000);
	await assert.rejects(
		ask({ ...solo, solo_parent_document_valid_through: '2026-10-04' }),
		/event-valid LGU document evidence/
	);
});

test('PH benefit distinguishes 105, 120 and 60 days and caps at six regular MSCs', () => {
	const history = months.map((row, i) =>
		i < 7 ? { ...row, regular_msc: 20_000 - 2_000 * i, paid_on: '2026-06-30' } : row
	);
	const calculate = (
		contingency: 'BIRTH' | 'MISCARRIAGE' | 'EMERGENCY_TERMINATION',
		solo_parent: boolean
	) =>
		calculateSssMaternityBenefit({
			contingency_date: '2026-10-05',
			contingency,
			solo_parent,
			months: history
		});
	assert.equal(calculate('BIRTH', false).total_msc, 90_000);
	assert.equal(calculate('BIRTH', false).candidate_benefit, 52_500);
	assert.equal(calculate('BIRTH', true).candidate_benefit, 60_000);
	assert.equal(calculate('MISCARRIAGE', false).candidate_benefit, 30_000);
	assert.equal(calculate('EMERGENCY_TERMINATION', false).candidate_benefit, 30_000);
	assert.throws(() => calculate('MISCARRIAGE', true), /solo-parent days/);
});

test('PH benefit refuses missing or duplicate history and preserves January quarter boundaries', () => {
	const input = {
		contingency_date: '2026-10-05',
		contingency: 'BIRTH' as const,
		solo_parent: false,
		months
	};
	assert.throws(
		() => calculateSssMaternityBenefit({ ...input, months: months.slice(1) }),
		/all twelve/
	);
	assert.throws(
		() => calculateSssMaternityBenefit({ ...input, months: [...months.slice(0, 11), months[0]!] }),
		/duplicate/i
	);
	assert.deepEqual(
		calculateSssMaternityBenefit({
			...input,
			contingency_date: '2026-01-01',
			months: months.map((row, index) => ({
				...row,
				coverage_month: `${index < 3 ? 2024 : 2025}-${String(((index + 9) % 12) + 1).padStart(2, '0')}`
			}))
		}).qualifying_window,
		{ from: '2024-10', through: '2025-09' }
	);
});

test('PH SSS statement rows require payment evidence and separate regular MSC', async () => {
	const row = {
		employee_id: 'mother',
		coverage_month: '2025-07',
		regular_msc: '20000.00',
		paid_on: '2025-07-31',
		source_reference: 'SSS paid statement 2025-07'
	};
	await transform(monthsCollection, [row]);
	for (const [change, message] of [
		[{ regular_msc: '20500.00' }, /regular SSS monthly salary credit/i],
		[{ regular_msc: '20000.001' }, /centavo precision/],
		[{ paid_on: null }, /unpaid SSS month/],
		[{ source_reference: ' ' }, /statement reference/],
		[{ coverage_month: '2025-13' }, /coverage month/]
	] as const)
		await assert.rejects(transform(monthsCollection, [{ ...row, ...change }]), message);
});
