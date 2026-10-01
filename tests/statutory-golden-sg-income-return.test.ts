// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Singapore's employment-income returns, hand-computed from the law.
 *
 * ITA 1947 s.68(2): the employer's annual return (Form IR8A, through AIS by 1 March); s.68(5)–(7):
 * notice of a non-citizen's cessation not later than one month before it, and no moneys paid until
 * 30 days after the Comptroller receives it (Form IR21). IRAS Explanatory Notes for Completion of
 * Form IR8A & Appendix 8A for the year ended 31 Dec 2026 (read 2026-09-28): para 5 commencement and
 * cessation; para 6 amendment (differences) and revision (whole record, never negative); item a the
 * salary due for the year; item b bonus; d3 notice pay taxable, compensation for loss of office not
 * taxable and outside the d total; deductions (I) compulsory CPF only, (II) donations incl. Yayasan
 * Mendaki, CDAC, SINDA, ECF, (III) Mosque Building Fund only. MUIS Table 1 (wages from 1 June 2016):
 * $19.50 = $13.50 Mosque and Religious Education + $6.00 Mendaki; $26.00 = $17.50 + $8.50.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { amendmentOf, incomeReturns } from '../src/lib/payroll/run/income-return.ts';
import { contributionSchemes, settingsVersions } from './fixtures/statutory-world.ts';

const version = settingsVersions('SG').find((row) =>
	row.effective_range.start.startsWith('2026-07-01')
);
const settings = version.payroll.income_return;
const EMPLOYER = { taxReference: '201912345K', name: 'Fixture Pte Ltd' };
const SIGNER = {
	name: 'Tan Mei Ling',
	designation: 'Director',
	contact: '61234567',
	date: '2027-02-15'
};

const months = (year, from, to) =>
	Array.from({ length: to - from + 1 }, (_, i) => `${year}-${String(from + i).padStart(2, '0')}`);
const base = (amount) => ({ componentCode: 'BASIC', family: 'BASE', bucket: 'EARNING', amount });
const slip = (employeeId, period, lines, charges = [], payDate = `${period}-28`) => ({
	employeeId,
	employmentId: `emp-${employeeId}`,
	period,
	payDate,
	lines,
	charges
});
const cpf = (employee, employer) => ({ scheme: 'CPF', employee, employer });
const mbmf = (employee) => ({ scheme: 'MBMF', employee, employer: 0 });

// A: citizen, Muslim, $5,000 a month all 2026; $200 OT in March, $100 no-pay leave in June, a $10,000
// ad hoc bonus in December. CPF (age ≤ 55, 2026): employee 20%, employer 17%, OW under the $8,000
// ceiling. MBMF: $4,000–$6,000 → $19.50; December's $15,000 → over $10,000 → $26.00.
const aSlips = months(2026, 1, 12).map((period) => {
	const lines = [base(5000)];
	let ow = 5000;
	if (period === '2026-03') {
		lines.push({ componentCode: 'OT-1.5X', family: 'WORK_DAY', bucket: 'EARNING', amount: 200 });
		ow = 5200;
	}
	if (period === '2026-06') {
		lines.push({ componentCode: 'UNPAID_LEAVE', family: 'LEAVE', bucket: 'ABSENCE', amount: 100 });
		ow = 4900;
	}
	const aw = period === '2026-12' ? 10000 : 0;
	if (aw > 0)
		lines.push({ componentCode: 'bonus', family: 'ADHOC', bucket: 'EARNING', amount: aw });
	return slip(
		'A',
		period,
		lines,
		[cpf(0.2 * (ow + aw), 0.17 * (ow + aw)), mbmf(ow + aw > 10000 ? 26 : 19.5)],
		period === '2026-12' ? '2026-12-31' : `${period}-28`
	);
});
// B: foreign employee (FIN), $6,000 a month from Nov 2025, ceased 30 Jun 2026 on retrenchment with a
// month's salary in lieu of notice and a $12,000 retrenchment benefit; no CPF (not a citizen or SPR).
const bSlips = [
	...months(2025, 11, 12).map((period) => slip('B', period, [base(6000)])),
	...months(2026, 1, 6).map((period) =>
		slip(
			'B',
			period,
			period === '2026-06'
				? [
						base(6000),
						{
							componentCode: 'SALARY_IN_LIEU_OF_NOTICE',
							family: 'ADHOC',
							bucket: 'EARNING',
							amount: 6000
						},
						{
							componentCode: 'RETRENCHMENT_BENEFIT',
							family: 'ADHOC',
							bucket: 'EARNING',
							amount: 12000
						}
					]
				: [base(6000)]
		)
	)
];
// C: a notified MBMF amount of $10 (no Schedule total), CDAC $1, a $200 contract allowance.
const cSlips = [
	slip(
		'C',
		'2026-01',
		[
			base(3000),
			{ componentCode: 'TRANSPORT', family: 'ALLOWANCE', bucket: 'EARNING', amount: 200 }
		],
		[cpf(640, 544), mbmf(10), { scheme: 'CDAC', employee: 1, employer: 0 }]
	)
];
const person = (id, identityNumber, extra = {}) => ({
	employeeId: id,
	employmentId: `emp-${id}`,
	employeeNumber: `E-${id}`,
	name: `Employee ${id}`,
	identityNumber,
	dateOfBirth: '1990-05-01',
	gender: 'FEMALE',
	nationality: 'SINGAPORE CITIZEN',
	designation: 'Engineer',
	hireDate: '2020-01-06',
	lastDay: null,
	departureOn: null,
	...extra
});
const PEOPLE = [
	person('A', 'S1234567D'),
	person('B', 'G1234567X', {
		nationality: 'INDIAN',
		gender: 'MALE',
		hireDate: '2025-11-03',
		lastDay: '2026-06-30',
		departureOn: '2026-07-04'
	}),
	person('C', 'T0123456G', { hireDate: '2026-01-02', lastDay: '2026-01-31' })
];
const HOLDS = [
	{
		employmentId: 'emp-B',
		amount: 3000,
		noWithholdingReason: null,
		noticeReceivedOn: '2026-06-10'
	}
];
const build = (extra = {}) =>
	incomeReturns({
		year: 2026,
		settings,
		employer: EMPLOYER,
		authorised: SIGNER,
		submission: 'ORIGINAL',
		slips: [...aSlips, ...bSlips, ...cSlips],
		people: PEOPLE,
		holds: HOLDS,
		maxWithholdDays: version.payroll.tax_clearance.max_withhold_days,
		...extra
	});

test('Singapore — every sealed version maps the IR8A items and the MUIS MBMF allocation', () => {
	for (const row of settingsVersions('SG')) {
		const income = row.payroll.income_return;
		assert.equal(income.form, 'IR8A', row.name);
		assert.match(income.authority, /s\.68\(2\)/);
		const item = (code) => income.classes.find((entry) => entry.code === code)?.item;
		assert.equal(item('bonus'), 'b_bonus_non_contractual');
		assert.equal(item('SALARY_IN_LIEU_OF_NOTICE'), 'd3_lump_sum');
		assert.equal(item('RETRENCHMENT_BENEFIT'), 'd3_compensation_for_loss_of_office');
		assert.deepEqual(
			[income.default_earning_item, income.default_allowance_item, income.remission_item],
			['a_gross_salary', 'd1_allowances', 'e1_remission']
		);
		assert.deepEqual(income.items.find((entry) => entry.key === 'd_total').sum_of.toSorted(), [
			'd1_allowances',
			'd2_commission',
			'd3_lump_sum',
			'd4_pension',
			'd5_overseas_pension_fund',
			'd6_excess_voluntary_cpf',
			'd7_gains_s10_1_b',
			'd7_gains_s10_1_g',
			'd8_benefits_in_kind'
		]);
		assert.deepEqual(
			income.identity_patterns.map((entry) => [entry.type, entry.pattern]),
			[
				['NRIC', '^[ST]\\d{7}[A-Z]$'],
				['FIN', '^[FGM]\\d{7}[A-Z]$']
			]
		);
		assert.deepEqual(income.cessation_return, { form: 'IR21', due_months_before_cessation: 1 });
		assert.equal(income.compulsory_scheme, 'CPF');
		assert.equal(income.compulsory_item, 'deduction_cpf_employee');
		assert.deepEqual([...income.donation_schemes].sort(), ['CDAC', 'ECF', 'SINDA']);
		assert.equal(income.split_fund.part_item, 'deduction_mosque_building_fund');
		assert.equal(income.split_fund.rest_item, 'deduction_donations');
		assert.deepEqual(
			income.split_fund.allocation.map((band) => [band.total, band.part, band.total - band.part]),
			[
				[3, 1.75, 1.25],
				[4.5, 3, 1.5],
				[6.5, 5, 1.5],
				[15, 11, 4],
				[19.5, 13.5, 6],
				[22, 14.5, 7.5],
				[24, 16, 8],
				[26, 17.5, 8.5]
			]
		);
		// Every MBMF Schedule rung the version charges has its allocation.
		const rungs = contributionSchemes('SG')
			.find((scheme) => scheme.settings_id === row.id && scheme.code === 'MBMF')
			.rules.flatMap(
				(rule) => /^round\(([\d.]+), 0\.01, 'HALF_UP'\)$/.exec(rule.employee)?.[1] ?? []
			)
			.map(Number);
		assert.deepEqual(
			rungs.toSorted((a, b) => a - b),
			income.split_fund.allocation.map((band) => band.total)
		);
		assert.ok(row.exit_facts.some((fact) => fact.key === 'departure_on'));
	}
});

test('Singapore — the IR8A of a full year: salary, bonus, compulsory CPF and the MBMF split', () => {
	const { annual } = build();
	const a = annual.find((row) => row.employee.id_number === 'S1234567D');
	assert.deepEqual(a.employee, {
		id_type: 'NRIC',
		id_number: 'S1234567D',
		employee_number: 'E-A',
		name: 'Employee A',
		date_of_birth: '1990-05-01',
		sex: 'F',
		nationality: 'SINGAPORE CITIZEN',
		designation: 'Engineer',
		// Commenced 2020, still employed: neither date is reported (para 5).
		commencement_on: null,
		cessation_on: null
	});
	assert.equal(a.form, 'IR8A');
	assert.equal(a.employer.taxReference, '201912345K');
	assert.deepEqual(a.authorised, SIGNER);
	// a: 12 × 5,000 + 200 OT − 100 no-pay leave = 60,100. b: the 10,000 ad hoc bonus, declared on
	// the December pay date. Together 70,100, the year's gross.
	assert.equal(a.amounts.a_gross_salary, 60100);
	assert.equal(a.amounts.b_bonus_non_contractual, 10000);
	assert.equal(a.amounts.b_bonus_contractual, 0);
	assert.equal(a.dates.b_bonus_declared_on, '2026-12-31');
	assert.equal(a.amounts.d_total, 0);
	assert.equal(a.amounts.d6_excess_voluntary_cpf, 0);
	// CPF employee: 9 × 1,000 + 1,040 (Mar) + 980 (Jun) + 3,000 (Dec, OW 1,000 + AW 2,000) = 14,020.
	assert.equal(a.amounts.deduction_cpf_employee, 14020);
	// MBMF: 11 × 19.50 + 26.00 = 240.50 = Mosque 11 × 13.50 + 17.50 = 166.00, Mendaki 11 × 6 + 8.50 = 74.50.
	assert.equal(a.amounts.deduction_mosque_building_fund, 166);
	assert.equal(a.amounts.deduction_donations, 74.5);
	assert.equal(a.amounts.deduction_life_insurance, 0);
});

test('Singapore — a notified MBMF amount is reported whole as Mosque Building Fund; an allowance is d1', () => {
	const c = build().annual.find((row) => row.employee.id_number === 'T0123456G');
	assert.equal(c.employee.commencement_on, '2026-01-02');
	assert.equal(c.employee.cessation_on, '2026-01-31');
	assert.equal(c.amounts.a_gross_salary, 3000);
	assert.equal(c.amounts.d1_allowances, 200);
	assert.equal(c.amounts.d_total, 200);
	assert.equal(c.amounts.deduction_mosque_building_fund, 10);
	assert.equal(c.amounts.deduction_donations, 1);
	assert.equal(c.amounts.deduction_cpf_employee, 640);
});

test('Singapore — a cleared foreign leaver files IR21, not IR8A, with both years and the withheld moneys', () => {
	const { annual, cessation } = build();
	assert.equal(
		annual.some((row) => row.employee.id_number === 'G1234567X'),
		false
	);
	assert.equal(cessation.length, 1);
	const b = cessation[0];
	assert.equal(b.form, 'IR21');
	assert.equal(b.employee.id_type, 'FIN');
	assert.equal(b.employee.commencement_on, null);
	assert.equal(b.employee.cessation_on, '2026-06-30');
	// s.68(5): not later than one month before 30 Jun 2026.
	assert.equal(b.notice_due_on, '2026-05-30');
	assert.equal(b.departure_on, '2026-07-04');
	// 2026: a 6 × 6,000 = 36,000; d3 notice pay 6,000; compensation 12,000 outside the d total.
	assert.equal(b.current_year.amounts.a_gross_salary, 36000);
	assert.equal(b.current_year.amounts.d3_lump_sum, 6000);
	assert.equal(b.current_year.amounts.d3_compensation_for_loss_of_office, 12000);
	assert.equal(b.current_year.amounts.d_total, 6000);
	assert.equal(b.current_year.amounts.deduction_cpf_employee, 0);
	// 2025: November and December, 12,000.
	assert.deepEqual([b.previous_year.year, b.previous_year.amounts.a_gross_salary], [2025, 12000]);
	assert.equal(b.withheld_amount, 3000);
	assert.equal(b.notice_received_on, '2026-06-10');
	// s.68(7): 30 days after IRAS received the notice.
	assert.equal(b.release_by, '2026-07-10');
});

test('Singapore — an AIS amendment submits only the differences; a revision restates the record', () => {
	const corrected = build().annual.find((row) => row.employee.id_number === 'S1234567D').amounts;
	const submitted = { ...corrected, a_gross_salary: 60000, deduction_donations: 80 };
	const amended = build({
		submission: 'AMENDMENT',
		submitted: new Map([['S1234567D', submitted]])
	}).annual.find((row) => row.employee.id_number === 'S1234567D');
	assert.equal(amended.submission, 'AMENDMENT');
	assert.equal(amended.amounts.a_gross_salary, 100);
	assert.equal(amended.amounts.deduction_donations, -5.5);
	assert.equal(amended.amounts.b_bonus_non_contractual, null);
	assert.deepEqual(amendmentOf(corrected, corrected).deduction_cpf_employee, null);
	const revised = build({ submission: 'REVISION' }).annual.find(
		(row) => row.employee.id_number === 'S1234567D'
	);
	assert.deepEqual(revised.amounts, corrected);
	assert.throws(
		() =>
			build({
				submission: 'REVISION',
				slips: [
					slip('A', '2026-01', [
						{ componentCode: 'BASIC', family: 'BASE', bucket: 'ABSENCE', amount: 10 }
					])
				]
			}),
		/cannot carry a negative amount/
	);
});

test('Singapore — a return cannot be filed on an identity that is neither NRIC nor FIN', () => {
	assert.throws(() => build({ people: [person('A', 'X9999')], slips: aSlips }), /NRIC or FIN/);
});
