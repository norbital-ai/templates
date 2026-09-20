import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory } from './fixtures/statutory-world.ts';
import { addUnpaidWorkingDays } from './fixtures/unpaid-leave.ts';

// Law 41/2024 art.33(5)-(6), art.53(8); Health Insurance Law art.12(2)(b), amended by 51/2024;
// Employment Law 74/2025 art.33(4); Circular 12/2025/TT-BNV art.9(4)(c).
// https://xaydungchinhsach.chinhphu.vn/toan-van-luat-so-41-2024-qh15-bao-hiem-xa-hoi-119240723163650489.htm
// https://congbao.cdnchinhphu.vn/CongBaoCP/VanBan/2025/2/44464/55506-1-2025539-54022-vbhn-vpqh.pdf
// https://xaydungchinhsach.chinhphu.vn/toan-van-luat-viec-lam-119250711173403835.htm
// https://xaydungchinhsach.chinhphu.vn/toan-van-thong-tu-12-2025-tt-bnv-quy-dinh-chi-tiet-mot-so-dieu-cua-luat-bhxh-ve-bhxh-bat-buoc-11925070415595016.htm
// Official application: birth leave beginning 14 August is SI-exempt despite fewer than 14 working days.
// https://chinhsachonline.chinhphu.vn/xac-dinh-thoi-gian-lam-viec-de-dong-bhxh-82176.htm
function benefitLeave(
	code: 'SICK_LEAVE' | 'MATERNITY_LEAVE' | 'PATERNITY_LEAVE',
	days: number,
	elections: Record<string, boolean | number | string>,
	options: { month?: string; hire?: string; type?: string; halfDay?: boolean } = {}
) {
	const month = options.month ?? '2026-01';
	return buildStatutory(
		{
			code: 'VN',
			period: month,
			region: 'I',
			people: [
				{
					key: 'BENEFIT',
					wage: 22000000,
					citizenship: 'CITIZEN',
					hire_date: options.hire,
					employment_type: options.type,
					registrations: { SI: { kind: 'REGISTERED', elections } }
				}
			]
		},
		(world) => {
			world.companies[0]!.pay_cutoff_day = 1;
			addUnpaidWorkingDays(world, month, days);
			const catalogue = world.leave_catalogue[0]!;
			catalogue.code = code;
			catalogue.name = code;
			catalogue.is_npl = false;
			catalogue.paid_by = 'FUND';
			for (const entry of world.leave_entries) entry.leave_code = code;
			if (options.halfDay) {
				const entry = world.leave_entries[0]!;
				entry.days = 0.5;
				entry.half_day_end = true;
				entry.charges![0]!.days = 0.5;
			}
		}
	).slips.get('BENEFIT')!;
}

function amounts(slip: ReturnType<typeof benefitLeave>) {
	return ['SI', 'HI', 'UI'].map(
		(code) => slip.statutory.find((row) => row.scheme_code === code)?.employee_amount ?? 0
	);
}

for (const month of ['2025-12', '2026-01', '2026-07']) {
	test(`VN ${month}: first working month with 14 sickness-benefit days requires SI but no payroll HI`, () => {
		const slip = benefitLeave(
			'SICK_LEAVE',
			14,
			{ sickness_benefit_eligible: true, long_term_sickness: false },
			{ month, hire: `${month}-01` }
		);
		assert.deepEqual(amounts(slip), [1760000, 0, 0]);
	});
	test(`VN ${month}: first return month with 14 sickness-benefit days requires SI`, () => {
		const slip = benefitLeave(
			'SICK_LEAVE',
			14,
			{
				sickness_benefit_eligible: true,
				long_term_sickness: false,
				first_return_month: true
			},
			{ month }
		);
		assert.deepEqual(amounts(slip), [1760000, 0, 0]);
	});
	test(`VN ${month}: listed long-term sickness transfers HI to the fund below 14 days`, () => {
		const slip = benefitLeave(
			'SICK_LEAVE',
			1,
			{
				sickness_benefit_eligible: true,
				long_term_sickness: true
			},
			{ month }
		);
		assert.deepEqual(amounts(slip), [1760000, 0, 220000]);
	});
}

test('VN sickness benefits require explicit eligibility and first-return status when they alter insurance', () => {
	assert.throws(
		() => benefitLeave('SICK_LEAVE', 14, {}),
		/Sickness benefit eligibility is required/
	);
	assert.throws(
		() => benefitLeave('SICK_LEAVE', 14, { sickness_benefit_eligible: true }),
		/Listed long-term sickness is required/
	);
	assert.throws(
		() =>
			benefitLeave('SICK_LEAVE', 14, {
				sickness_benefit_eligible: true,
				long_term_sickness: false
			}),
		/First month back at work is required/
	);
});

test('VN employees outside SI coverage do not require irrelevant sickness declarations', () => {
	assert.deepEqual(amounts(benefitLeave('SICK_LEAVE', 14, {}, { type: 'INTERN' })), [0, 0, 0]);
});

test('VN an ordinary sickness month can continue SI without charging fund-paid HI twice', () => {
	const slip = benefitLeave('SICK_LEAVE', 14, {
		sickness_benefit_eligible: true,
		long_term_sickness: false,
		first_return_month: false,
		continue_si_unpaid: true,
		continued_si_base: 17000000,
		continued_si_reference: 'CONTINUATION-01'
	});
	assert.deepEqual(amounts(slip), [1360000, 0, 0]);
});

test('VN absence without sickness entitlement retains the ordinary unpaid continuation rule', () => {
	const slip = benefitLeave('SICK_LEAVE', 14, {
		sickness_benefit_eligible: false,
		continue_si_unpaid: true,
		continued_si_base: 17000000,
		continued_si_reference: 'CONTINUATION-01'
	});
	assert.deepEqual(amounts(slip), [1360000, 255000, 0]);
});

test('VN listed long-term sickness transfers HI for a half-day benefit absence', () => {
	const slip = benefitLeave(
		'SICK_LEAVE',
		1,
		{
			sickness_benefit_eligible: true,
			long_term_sickness: true
		},
		{ halfDay: true }
	);
	assert.deepEqual(amounts(slip), [1760000, 0, 220000]);
	assert.equal(slip.gross, 21500000);
});

test('VN a retained long-term sickness declaration does not exempt a month without benefit leave', () => {
	const slip = benefitLeave('SICK_LEAVE', 0, {
		sickness_benefit_eligible: true,
		long_term_sickness: true
	});
	assert.deepEqual(amounts(slip), [1760000, 330000, 220000]);
});

for (const category of ['BIRTH', 'ADOPTION', 'SURROGATE_BIRTH', 'COMMISSIONING_MOTHER'])
	test(`VN ${category} maternity benefit is SI-exempt below 14 working days`, () => {
		const slip = benefitLeave('MATERNITY_LEAVE', 12, {
			maternity_benefit_eligible: true,
			maternity_category: category,
			...(category === 'BIRTH' ? { maternity_returned_early: false } : {})
		});
		assert.deepEqual(amounts(slip), [0, 330000, 220000]);
	});

test('VN other maternity benefits use the 14-working-day contribution threshold', () => {
	for (const [days, expected] of [
		[13, [1760000, 330000, 220000]],
		[14, [0, 0, 0]]
	] as const) {
		const slip = benefitLeave('PATERNITY_LEAVE', days, {
			maternity_benefit_eligible: true,
			maternity_category: 'OTHER'
		});
		assert.deepEqual(amounts(slip), expected);
	}
});

test('VN early return resumes SI and HI while UI retains its unpaid-day threshold', () => {
	const slip = benefitLeave('MATERNITY_LEAVE', 14, {
		maternity_benefit_eligible: true,
		maternity_category: 'BIRTH',
		maternity_returned_early: true
	});
	assert.deepEqual(amounts(slip), [1760000, 330000, 0]);
});

test('VN maternity contribution treatment requires eligibility and a lawful category', () => {
	assert.throws(
		() => benefitLeave('MATERNITY_LEAVE', 12, {}),
		/Maternity benefit eligibility is required/
	);
	assert.throws(
		() => benefitLeave('MATERNITY_LEAVE', 12, { maternity_benefit_eligible: true }),
		/Maternity contribution category is required/
	);
	assert.throws(
		() =>
			benefitLeave('MATERNITY_LEAVE', 12, {
				maternity_benefit_eligible: true,
				maternity_category: 'BIRTH'
			}),
		/Returned early from birth maternity leave is required/
	);
	assert.throws(
		() =>
			benefitLeave('PATERNITY_LEAVE', 5, {
				maternity_benefit_eligible: true,
				maternity_category: 'BIRTH',
				maternity_returned_early: false
			}),
		/Birth, adoption and surrogacy categories require maternity leave/
	);
});

test('VN employees outside SI coverage do not require irrelevant maternity declarations', () => {
	assert.deepEqual(amounts(benefitLeave('MATERNITY_LEAVE', 14, {}, { type: 'INTERN' })), [0, 0, 0]);
});

test('VN ineligible maternity absence follows ordinary unpaid continuation', () => {
	const slip = benefitLeave('MATERNITY_LEAVE', 14, {
		maternity_benefit_eligible: false,
		continue_si_unpaid: true,
		continued_si_base: 17000000,
		continued_si_reference: 'CONTINUATION-MATERNITY-01'
	});
	assert.deepEqual(amounts(slip), [1360000, 255000, 0]);
});

test('VN maternity elections are effective-dated for exemption and early return', () => {
	for (const [month, expected] of [
		['2026-01', [0, 0, 0]],
		['2026-02', [1760000, 330000, 0]]
	] as const) {
		const result = buildStatutory(
			{
				code: 'VN',
				period: month,
				region: 'I',
				people: [{ key: 'DATED-MATERNITY', wage: 22000000, citizenship: 'CITIZEN' }]
			},
			(world) => {
				world.companies[0]!.pay_cutoff_day = 1;
				addUnpaidWorkingDays(world, month, 14);
				const catalogue = world.leave_catalogue[0]!;
				catalogue.code = 'MATERNITY_LEAVE';
				catalogue.name = 'MATERNITY_LEAVE';
				catalogue.is_npl = false;
				catalogue.paid_by = 'FUND';
				for (const entry of world.leave_entries) entry.leave_code = 'MATERNITY_LEAVE';
				const schemes = new Set(
					world.statutory_contributions.filter((row) => row.code === 'SI').map((row) => row.id)
				);
				for (const fact of [...world.employment_statutory_facts]) {
					if (!schemes.has(fact.statutory_contribution_id) || fact.status.kind !== 'REGISTERED')
						continue;
					fact.effective_range = { start: '2026-01-01', end: '2026-01-31' };
					fact.status.elections = {
						maternity_benefit_eligible: true,
						maternity_category: 'BIRTH',
						maternity_returned_early: false
					};
					world.employment_statutory_facts.push({
						...fact,
						id: `${fact.id}-return`,
						effective_range: { start: '2026-02-01', end: null },
						status: {
							...fact.status,
							elections: {
								maternity_benefit_eligible: true,
								maternity_category: 'BIRTH',
								maternity_returned_early: true
							}
						}
					});
				}
			}
		);
		assert.deepEqual(amounts(result.slips.get('DATED-MATERNITY')!), expected);
	}
});

for (const month of ['2025-12', '2026-01', '2026-07'])
	test(`VN ${month}: monthly part-time employment is outside the SI 14-day waiver`, () => {
		const result = buildStatutory(
			{
				code: 'VN',
				period: month,
				region: 'I',
				people: [
					{
						key: 'PART-TIME',
						wage: 22000000,
						citizenship: 'CITIZEN',
						employment_type: 'PART_TIME',
						registrations: { SI: { kind: 'REGISTERED', elections: {} } }
					}
				]
			},
			(world) => {
				world.companies[0]!.pay_cutoff_day = 1;
				addUnpaidWorkingDays(world, month, 14);
			}
		);
		assert.deepEqual(amounts(result.slips.get('PART-TIME')!), [1760000, 330000, 0]);
	});
