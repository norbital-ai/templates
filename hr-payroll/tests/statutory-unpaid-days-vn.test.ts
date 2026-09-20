import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { buildStatutory, createStatutoryWorld, COMPANY_ID } from './fixtures/statutory-world.ts';
import { addUnpaidWorkingDays } from './fixtures/unpaid-leave.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';

// BHXH letter 371/BHXH-QLT, 7 July 2025, section 1.2: a paid half-day is a working day.
// https://cdn.thuvienphapluat.vn/uploads/Hoidapphapluat/2025/LNMT/Thang_7/250707/QLT-%C4%90VSDL%C4%90.pdf
for (const month of ['2025-12', '2026-01', '2026-07'])
	for (const fullDays of [13, 14])
		test(`VN ${month}: ${fullDays} full unpaid days and two half-days use whole days for insurance`, () => {
			const result = buildStatutory(
				{
					code: 'VN',
					period: month,
					region: 'I',
					people: [
						{
							key: 'PARTIAL',
							wage: 22000000,
							citizenship: 'CITIZEN',
							registrations: {
								SI: { kind: 'REGISTERED', elections: { continue_si_unpaid: false } }
							}
						}
					]
				},
				(world) => {
					world.companies[0]!.pay_cutoff_day = 1;
					addUnpaidWorkingDays(world, month, fullDays + 2);
					for (const entry of world.leave_entries.slice(-2)) {
						entry.days = 0.5;
						entry.half_day_end = true;
						entry.charges![0]!.days = 0.5;
					}
				}
			);
			const slip = result.slips.get('PARTIAL')!;
			assert.deepEqual(
				['SI', 'HI', 'UI'].map(
					(code) => slip.statutory.find((row) => row.scheme_code === code)?.employee_amount ?? 0
				),
				fullDays === 13 ? [1760000, 330000, 220000] : [0, 0, 0]
			);
			// All three fixture months have 22 or 23 weekdays. Salary still deducts both half-days.
			const weekdays = Array.from(
				{ length: 31 },
				(_, index) => new Date(`${month}-${String(index + 1).padStart(2, '0')}T00:00:00Z`)
			).filter(
				(date) => date.toISOString().startsWith(month) && ![0, 6].includes(date.getUTCDay())
			).length;
			assert.equal(slip.gross, Math.round((22000000 * (weekdays - fullDays - 1)) / weekdays));
		});

test('VN two unpaid half-days on one date count as one full day', () => {
	const result = buildStatutory(
		{
			code: 'VN',
			period: '2026-01',
			region: 'I',
			people: [{ key: 'TWO-HALVES', wage: 22000000, citizenship: 'CITIZEN' }]
		},
		(world) => {
			world.companies[0]!.pay_cutoff_day = 1;
			addUnpaidWorkingDays(world, '2026-01', 14);
			const last = world.leave_entries.at(-1)!;
			last.days = 0.5;
			last.half_day_end = true;
			last.charges![0]!.days = 0.5;
			world.leave_entries.push({
				...last,
				id: 'e1000000-0000-4000-8000-999999999999',
				reference: 'NPL-SECOND-HALF',
				half_day_start: true,
				half_day_end: false,
				charges: last.charges!.map((charge) => ({ ...charge }))
			});
		}
	);
	const slip = result.slips.get('TWO-HALVES')!;
	assert.equal(slip.gross, 8000000);
	assert.deepEqual(
		['SI', 'HI', 'UI'].map(
			(code) => slip.statutory.find((row) => row.scheme_code === code)?.employee_amount ?? 0
		),
		[0, 0, 0]
	);
});

for (const cutoff of ['FIRST', 'SPLIT', 'LAST'])
	test(`VN ${cutoff} closes semi-monthly insurance using full unpaid dates`, () => {
		const world = createStatutoryWorld({
			code: 'VN',
			period: '2026-01-1',
			payFrequency: 'SEMI_MONTHLY',
			region: 'I',
			people: [
				{ key: 'PARTIAL', wage: 22000000, citizenship: 'CITIZEN', pay_frequency: 'SEMI_MONTHLY' }
			]
		});
		world.companies[0]!.semi_monthly_statutory_cutoff = cutoff;
		addUnpaidWorkingDays(world, '2026-01', 15);
		for (const entry of world.leave_entries.slice(-2)) {
			entry.days = 0.5;
			entry.half_day_end = true;
			entry.charges![0]!.days = 0.5;
		}
		const amounts = new Map<string, number>();
		for (const period of ['2026-01-1', '2026-01-2']) {
			const prepared = Effect.runSync(
				gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period })
			);
			const built = buildPayrollRun(prepared);
			world.payroll_runs.push({
				id: period,
				company_id: COMPANY_ID,
				period,
				company_charges: built.company_charges
			});
			for (const slip of built.payslip_payroll_run) {
				world.payslips.push({ ...slip, payroll_run_id: period, paid_at: prepared.window.payDate });
				for (const row of slip.statutory)
					amounts.set(row.scheme_code, (amounts.get(row.scheme_code) ?? 0) + row.employee_amount);
			}
			for (const capture of built.captures)
				for (const entry of world.leave_entries)
					if (capture.leave.includes(String(entry.id))) entry.payslip_id = capture.payslipId;
		}
		assert.deepEqual(
			['SI', 'HI', 'UI'].map((code) => amounts.get(code) ?? 0),
			[1760000, 330000, 220000]
		);
	});
