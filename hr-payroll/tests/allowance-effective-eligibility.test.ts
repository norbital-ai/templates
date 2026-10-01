import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory, settingsIdOn } from './fixtures/statutory-world.ts';

// A contractual allowance earned only while the dated basic salary is at least 5,000.
// January 2026 contains eleven Mon–Fri days on each side of the 16 January change.
for (const [name, opening, closing] of [
	['eligibility ends', 6000, 4000],
	['eligibility begins', 4000, 6000]
] as const) {
	test(`standing allowance retains only eligible dated terms: ${name}`, () => {
		const built = buildStatutory(
			{
				code: 'SG',
				period: '2026-01',
				people: [{ key: 'DATED', wage: opening, citizenship: 'CITIZEN' }]
			},
			(world) => {
				const id = 'c1c1c1c1-0000-4000-8000-000000000099';
				world.allowance_catalogue.push({
					id,
					settings_id: settingsIdOn('SG', '2026-01-01'),
					code: 'DATED_ALLOWANCE',
					name: 'Contractual dated allowance',
					eligibility: 'terms.basic_salary >= 5000',
					destination: 'PAY',
					direction: 'ADD',
					bands: [{ when: '', amount: 'entry.amount', limit: null }],
					counts_toward: ['CPF.ORDINARY', 'SDL'],
					approval_id: null
				});
				const term = world.employment_terms[0]!;
				term.allowances = [{ catalogue_id: id, amount: 220 }];
				const next = structuredClone(term);
				term.effective_range.end = '2026-01-15T15:59:59.999Z';
				next.id = 'd0000000-0000-4000-8000-000000000099';
				next.effective_range.start = '2026-01-16T00:00:00.000Z';
				next.base_salary = closing;
				world.employment_terms.push(next);
			}
		);
		const line = built.slips
			.get('DATED')!
			.base.find((row) => row.component_code === 'DATED_ALLOWANCE');
		assert.equal(line?.amount, 110, '220 × 11 eligible working days / 22');
		const segments = built.allowances.get('DATED')!;
		assert.equal(segments.length, 1);
		assert.equal(segments[0]!.prorated_amount, 110);
		assert.equal(segments[0]!.from, opening >= 5000 ? '2026-01-01' : '2026-01-16');
		assert.equal(segments[0]!.to, opening >= 5000 ? '2026-01-15' : '2026-01-31');
	});
}

test('standing allowance follows dated registration facts within unchanged terms', () => {
	const built = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [{ key: 'FACT', wage: 6000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			const id = 'c1c1c1c1-0000-4000-8000-000000000098';
			world.allowance_catalogue.push({
				id,
				settings_id: settingsIdOn('SG', '2026-01-01'),
				code: 'DATED_FACT',
				name: 'Contractual registration allowance',
				eligibility: 'facts.CPF.registered',
				destination: 'PAY',
				direction: 'ADD',
				bands: [{ when: '', amount: 'entry.amount', limit: null }],
				counts_toward: ['SDL'],
				approval_id: null
			});
			world.employment_terms[0]!.allowances = [{ catalogue_id: id, amount: 220 }];
			const cpfIds = new Set(
				world.statutory_contributions.filter((row) => row.code === 'CPF').map((row) => row.id)
			);
			for (const [index, fact] of world.employment_statutory_facts
				.filter((row) => cpfIds.has(row.statutory_contribution_id))
				.entries()) {
				const next = structuredClone(fact);
				fact.effective_range = { ...fact.effective_range, end: '2026-01-15' };
				next.id = `d0000000-0000-4000-8000-${String(980 + index).padStart(12, '0')}`;
				next.effective_range = { start: '2026-01-16', end: null };
				next.status = {
					kind: 'NOT_REGISTERED',
					reason: 'Synthetic dated registration declaration.'
				};
				world.employment_statutory_facts.push(next);
			}
		}
	);
	assert.equal(
		built.slips.get('FACT')!.base.find((row) => row.component_code === 'DATED_FACT')?.amount,
		110
	);
	assert.equal(built.allowances.get('FACT')![0]!.to, '2026-01-15');
});

// A presentation-only terms split must not move a prior-cutoff no-pay day into another run.
const cutoffPrice = (split: boolean, date = '2025-12-23', days = 1, nextAmount = 220) =>
	buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [{ key: 'CUTOFF', wage: 6000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			const allowanceId = 'c1c1c1c1-0000-4000-8000-000000000097';
			const leaveId = 'c1c1c1c1-0000-4000-8000-000000000096';
			const settings = settingsIdOn('SG', '2026-01-01');
			world.allowance_catalogue.push({
				id: allowanceId,
				settings_id: settings,
				code: 'CUTOFF_ALLOWANCE',
				name: 'Standing allowance',
				eligibility: '',
				destination: 'PAY',
				direction: 'ADD',
				bands: [{ when: '', amount: 'entry.amount', limit: null }],
				counts_toward: ['CPF.ORDINARY', 'SDL'],
				approval_id: null
			});
			world.leave_catalogue.push({
				id: leaveId,
				settings_id: settings,
				code: 'UNPAID_LEAVE',
				name: 'Unpaid leave',
				eligibility: '',
				evidence: 'NONE',
				evidence_after_days: null,
				entitlement: {
					availability: 'UNLIMITED',
					year_start_month: 1,
					proration: 'NONE',
					bands: []
				},
				is_npl: true,
				can_encash: false,
				bands: [],
				approval_id: null
			});
			const term = world.employment_terms[0]!;
			term.allowances = [{ catalogue_id: allowanceId, amount: 220 }];
			world.leave_entries.push({
				id: 'e1000000-0000-4000-8000-000000000097',
				employment_id: world.employments[0]!.id,
				catalogue_id: leaveId,
				leave_code: 'UNPAID_LEAVE',
				reference: 'PRIOR-CUTOFF',
				from_date: date,
				to_date: date,
				half_day_start: days === 0.5,
				half_day_end: false,
				days,
				no_pay_origin: 'EMPLOYEE_REQUESTED',
				effective_on: date,
				reason: 'Synthetic unpaid day',
				allocations: [],
				approval_id: null,
				charges: [
					{
						date,
						days,
						catalogue_id: leaveId,
						employment_term_id: term.id,
						holiday_id: null,
						shift_definition_id: null,
						work_day_id: null
					}
				]
			});
			if (split) {
				const next = structuredClone(term);
				term.effective_range = { ...term.effective_range, end: '2026-01-15' };
				next.id = 'd0000000-0000-4000-8000-000000000097';
				next.effective_range = { ...next.effective_range, start: '2026-01-16' };
				next.job_title = 'Unrelated title change';
				next.allowances = [{ catalogue_id: allowanceId, amount: nextAmount }];
				if (date >= '2026-01-16') world.leave_entries[0]!.charges[0]!.employment_term_id = next.id;
				world.employment_terms.push(next);
			}
		}
	)
		.slips.get('CUTOFF')!
		.base.find((row) => row.component_code === 'CUTOFF_ALLOWANCE')!.amount;
test('standing allowance withholding is invariant under an unrelated terms split at cutoff 21', () => {
	assert.equal(cutoffPrice(false), 210.43, 'captured December divisor: 220 − 220/23');
	assert.equal(cutoffPrice(true), 210.43, 'the same pending withholding survives a terms split');
});

test('standing allowance withholds partial no-pay days at the actual dated rate', () => {
	assert.equal(cutoffPrice(false, '2026-01-14', 0.5), 215, '220 − half of 220/22');
	assert.equal(cutoffPrice(true, '2026-01-14', 0.5, 440), 325, '110 + 220 − 5 before increase');
	assert.equal(cutoffPrice(true, '2026-01-19', 0.5, 440), 320, '110 + 220 − 10 after increase');
});

test('standing allowance clips earned cash to actual hire and departure dates', () => {
	const built = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [
				{ key: 'HIRED', wage: 6000, citizenship: 'CITIZEN', hire_date: '2026-01-19' },
				{ key: 'LEFT', wage: 6000, citizenship: 'CITIZEN', exit_date: '2026-01-15' }
			]
		},
		(world) => {
			const id = 'c1c1c1c1-0000-4000-8000-000000000095';
			world.allowance_catalogue.push({
				id,
				settings_id: settingsIdOn('SG', '2026-01-01'),
				code: 'EMPLOYED_ALLOWANCE',
				name: 'Contractual allowance',
				eligibility: '',
				destination: 'PAY',
				direction: 'ADD',
				bands: [{ when: '', amount: 'entry.amount', limit: null }],
				counts_toward: ['CPF.ORDINARY', 'SDL'],
				approval_id: null
			});
			for (const term of world.employment_terms)
				term.allowances = [{ catalogue_id: id, amount: 220 }];
		}
	);
	assert.equal(
		built.slips.get('HIRED')!.base.find((row) => row.component_code === 'EMPLOYED_ALLOWANCE')!
			.amount,
		100
	);
	assert.equal(
		built.slips.get('LEFT')!.base.find((row) => row.component_code === 'EMPLOYED_ALLOWANCE')!
			.amount,
		110
	);
	assert.equal(built.allowances.get('HIRED')![0]!.from, '2026-01-19');
	assert.equal(built.allowances.get('LEFT')![0]!.to, '2026-01-15');
});
