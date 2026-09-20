import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory } from './fixtures/statutory-world.ts';
import { addUnpaidWorkingDays } from './fixtures/unpaid-leave.ts';

// Law 41/2024 arts.31(1)(đ), 33(5), 34(3); Decree 158/2025 art.43(2).
// https://xaydungchinhsach.chinhphu.vn/toan-van-luat-so-41-2024-qh15-bao-hiem-xa-hoi-119240723163650489.htm
// HI follows SI continuation: https://baohiemxahoi.gov.vn/tintuc/Pages/linh-vuc-bao-hiem-xa-hoi.aspx?CateID=168&ItemID=26671
const agreed = {
	continue_si_unpaid: true,
	continued_si_base: 17000000,
	continued_si_reference: 'AGREEMENT-01'
};

function calculate(
	elections: Record<string, boolean | number | string>,
	month = '2026-01',
	reduced = false
) {
	return buildStatutory(
		{
			code: 'VN',
			period: month,
			region: 'I',
			people: [{ key: 'UNPAID', wage: 22000000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			addUnpaidWorkingDays(world, month, 14);
			world.companies[0]!.facts = {
				...world.companies[0]!.facts,
				occupational_accident_reduced: reduced
			};
			const schemes = new Set(
				world.statutory_contributions.filter((row) => row.code === 'SI').map((row) => row.id)
			);
			for (const fact of world.employment_statutory_facts)
				if (schemes.has(fact.statutory_contribution_id) && fact.status.kind === 'REGISTERED')
					fact.status.elections = elections;
		}
	);
}

test('VN unpaid continuation refuses unknown agreement, missing base and missing evidence', () => {
	for (const [elections, message] of [
		[{}, /Continue SI during unpaid leave is required/],
		[{ continue_si_unpaid: true }, /Last SI contribution base.*is required/],
		[
			{ continue_si_unpaid: true, continued_si_base: 17000000 },
			/Continuation agreement reference is required/
		],
		[{ ...agreed, continued_si_base: 0 }, /Last SI contribution base.*must be at least 1/],
		[{ ...agreed, continued_si_reference: ' ' }, /Continuation agreement reference/]
	] as const)
		assert.throws(() => calculate(elections), message);
	const declined = calculate({ continue_si_unpaid: false }).slips.get('UNPAID')!;
	assert.equal(declined.statutory.find((row) => row.scheme_code === 'SI')?.employee_amount ?? 0, 0);
	assert.equal(declined.statutory.find((row) => row.scheme_code === 'HI')?.employee_amount ?? 0, 0);
});

test('VN continuation retains the declared base, employer accident rate and company levy', () => {
	for (const reduced of [false, true]) {
		const result = calculate(agreed, '2026-01', reduced);
		const si = result.slips.get('UNPAID')!.statutory.find((row) => row.scheme_code === 'SI')!;
		assert.deepEqual(
			[si.base_amount, si.employee_amount, si.employer_amount],
			[17000000, 1360000, reduced ? 2941000 : 2975000]
		);
		assert.deepEqual(result.companyCharges.get('UNION_FEE'), [17000000, 340000]);
	}
});

test('VN continuation applies the reference-level floor at contribution time', () => {
	const result = calculate({ ...agreed, continued_si_base: 2340000 }, '2026-07');
	const lines = result.slips.get('UNPAID')!.statutory;
	const si = lines.find((row) => row.scheme_code === 'SI')!;
	const hi = lines.find((row) => row.scheme_code === 'HI')!;
	assert.deepEqual(
		[si.base_amount, si.employee_amount, si.employer_amount],
		[2530000, 202400, 442750]
	);
	assert.deepEqual(
		[hi.base_amount, hi.employee_amount, hi.employer_amount],
		[2530000, 37950, 75900]
	);
});

test('VN continuation uses only the agreement effective for the contribution month', () => {
	for (const month of ['2026-01', '2026-02', '2026-03']) {
		const result = buildStatutory(
			{
				code: 'VN',
				period: month,
				region: 'I',
				people: [{ key: 'UNPAID', wage: 22000000, citizenship: 'CITIZEN' }]
			},
			(world) => {
				addUnpaidWorkingDays(world, month, 14);
				const schemes = new Set(
					world.statutory_contributions.filter((row) => row.code === 'SI').map((row) => row.id)
				);
				for (const fact of [...world.employment_statutory_facts]) {
					if (!schemes.has(fact.statutory_contribution_id) || fact.status.kind !== 'REGISTERED')
						continue;
					fact.effective_range = { ...fact.effective_range, end: '2026-01-31' };
					fact.status.elections = { continue_si_unpaid: false };
					world.employment_statutory_facts.push(
						{
							...fact,
							id: `${fact.id}-agreed`,
							effective_range: { start: '2026-02-01', end: '2026-02-28' },
							status: { ...fact.status, elections: agreed }
						},
						{
							...fact,
							id: `${fact.id}-ended`,
							effective_range: { start: '2026-03-01', end: null },
							status: { ...fact.status }
						}
					);
				}
			}
		);
		const lines = result.slips.get('UNPAID')!.statutory;
		assert.deepEqual(
			['SI', 'HI', 'UI'].map(
				(code) => lines.find((row) => row.scheme_code === code)?.employee_amount ?? 0
			),
			month === '2026-02' ? [1360000, 255000, 0] : [0, 0, 0],
			month
		);
	}
});

for (const [unpaid, gross, unfunded, net] of [
	[20, 2000000, 0, 385000],
	[21, 1000000, 615000, 0],
	[22, 0, 1615000, 0]
] as const)
	test(`VN continuation preserves the liability with ${unpaid} unpaid working days`, () => {
		const result = buildStatutory(
			{
				code: 'VN',
				period: '2026-01',
				region: 'I',
				people: [
					{
						key: 'UNPAID',
						wage: 22000000,
						citizenship: 'CITIZEN',
						registrations: { SI: { kind: 'REGISTERED', elections: agreed } }
					}
				]
			},
			(world) => {
				world.companies[0]!.pay_cutoff_day = 1;
				addUnpaidWorkingDays(world, '2026-01', unpaid);
			}
		);
		const slip = result.slips.get('UNPAID')!;
		assert.deepEqual(
			[slip.gross, slip.total_deductions, slip.unfunded_contributions, slip.net],
			[gross, 1615000, unfunded, net]
		);
		assert.deepEqual(
			slip.statutory
				.filter((row) => ['SI', 'HI'].includes(row.scheme_code))
				.map((row) => [row.scheme_code, row.employee_amount, row.employer_amount])
				.sort(),
			[
				['HI', 255000, 510000],
				['SI', 1360000, 2975000]
			]
		);
	});
