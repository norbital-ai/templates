import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { calculateLeavePayroll, withLeaveDeductionEligibility } from '../src/lib/leave/payroll.ts';
import { planLeaveActivity } from '../src/lib/leave/activity.ts';
import { id, leaveContext, submission, timeOff } from './helpers/manual-leave-context.ts';

const rows = JSON.parse(
	readFileSync(new URL('../seed/jurisdiction/TW/leave_catalogue.json', import.meta.url), 'utf8')
) as ReturnType<typeof leaveContext>['catalogues'];

for (const menstrual of rows.filter((row) => row.code === 'MENSTRUAL_LEAVE')) {
	for (const sickDays of [29, 29.5, 30])
		test(`TW §14: ${menstrual.settings_id} prices a monthly menstrual day after ${sickDays} sick days`, () => {
			// MOL 12 March 2021 clarification: three exempt days + thirty pooled sick days
			// exhaust half pay, but a later monthly menstrual day must still be granted.
			// https://www.mol.gov.tw/1607/1632/1640/32923/post
			const context = leaveContext();
			context.catalogues = rows
				.filter((row) => row.settings_id === menstrual.settings_id)
				.map((row) => ({ ...row, settings_id: id(6) }));
			const sick = context.catalogues.find((row) => row.code === 'SICK_LEAVE')!;
			const take = (catalogueId: string, from: string, to: string, sequence: number) => {
				const plan = planLeaveActivity(
					context,
					{
						...submission(timeOff(from, to), `SYNTHETIC-${sequence}`),
						catalogue_id: catalogueId,
						half_day_end: catalogueId === sick.id && sickDays === 29.5
					},
					id(sequence)
				);
				context.entries.push({ ...plan, id: id(sequence), approval_id: null });
				return plan;
			};
			for (const [date, sequence] of [
				['2026-01-05', 84],
				['2026-02-02', 85],
				['2026-03-02', 86]
			] as const) {
				const exempt = take(menstrual.id, date, date, sequence);
				assert.equal(exempt.days, 1);
				assert.equal(exempt.allocations.filter((row) => row.pool === 'SICK_LEAVE').length, 0);
			}
			take(sick.id, '2026-04-01', sickDays === 29 ? '2026-04-29' : '2026-04-30', 87);
			const overflow = take(menstrual.id, '2026-05-04', '2026-05-04', 88);
			assert.equal(overflow.days, 1);
			const unpaid = sickDays - 29;
			assert.equal(
				overflow.allocations
					.filter((row) => row.pool === 'SICK_LEAVE')
					.reduce((sum, row) => sum - row.days, 0),
				1 - unpaid
			);
			assert.equal(overflow.charges[0]!.unpaid_days ?? 0, unpaid);
			assert.throws(() => take(menstrual.id, '2026-05-05', '2026-05-05', 89), /Insufficient leave/);
			const prepared = withLeaveDeductionEligibility(
				{
					entries: [context.entries.at(-1)!],
					catalogues: context.catalogues,
					captures: [],
					schemes: []
				},
				{
					employment: context.employments[0]!,
					servicePeriods: [{ start: '2025-01-01', end: null }],
					employee: context.employees[0]!,
					configuration: {
						company: {
							id: id(3),
							name: 'Synthetic',
							settings_code: 'TEST',
							region: null,
							facts: {}
						},
						recordedCompanyFacts: {},
						companyFactRevisions: [],
						lineageVersions: context.versions
					} as never,
					statutoryFacts: [],
					terms: context.terms
				}
			);
			// TWD30,000 / 30 = 1,000 per day: 500, 750, or 1,000 deducted.
			const settled = calculateLeavePayroll({
				prepared,
				window: { start: '2026-05-01', end: '2026-05-31' },
				dueThrough: '2026-05-31',
				currency: 'TWD',
				absenceRate: () => 1000,
				encashmentRate: () => 1000
			});
			assert.deepEqual(
				settled.captures.flatMap((capture) => capture.pay_items.map((item) => item.amount)),
				[500 + 500 * unpaid]
			);
			const reversal = planLeaveActivity(
				context,
				{
					...submission(
						{
							as_adjustment_entry: true,
							reversal_of_id: id(88),
							effective_on: '2026-05-06',
							days: null,
							reason: 'Synthetic reversal'
						},
						'SYNTHETIC-REVERSAL'
					),
					catalogue_id: menstrual.id
				},
				id(90)
			);
			assert.equal(
				reversal.allocations
					.filter((row) => row.pool === 'SICK_LEAVE')
					.reduce((sum, row) => sum + row.days, 0),
				1 - unpaid
			);
			context.entries.push({ ...reversal, id: id(90), approval_id: null });
			const replacement = take(menstrual.id, '2026-05-07', '2026-05-07', 91);
			assert.equal(replacement.charges[0]!.unpaid_days ?? 0, unpaid);
			assert.equal(overflow.charges[0]!.unpaid_days ?? 0, unpaid);
		});
}
