// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { computedEntitlement, leaveWindowOf } from '../src/lib/leave/entitlement.ts';
import { personContext } from '../src/lib/payroll/run/eligibility.ts';
import { settleExit } from '../src/lib/leave/exit-settlement.ts';
import leaveEntries from '../src/data/collection/leave_entries/+collection.ts';
import payrollRuns from '../src/data/collection/payroll_runs/+collection.ts';
import {
	COMPANY_ID,
	createStatutoryWorld,
	leaveCatalogue,
	settingsIdOn
} from './fixtures/statutory-world.ts';
import { memoryDb, runTransform } from './helpers/ctx.ts';

// Synthetic leap-year arithmetic under currently sealed law, not a prediction of 2028 law.
// Enterprise annual-leave measure arts.5/12 expressly divide by 365:
// https://rsj.sh.gov.cn/trlzyhshbzbgz_17256/20200617/t0035_1388390.html
const PERIOD = '2028-03';
const HIRE = '2025-01-01';
for (const code of ['CN-shanghai', 'CN-kunming']) {
	const region = code === 'CN-shanghai' ? 'SHANGHAI' : 'KUNMING';
	for (const [exit, expected] of [
		['2028-03-12', 0],
		['2028-03-13', 1],
		['2028-03-14', 1]
	]) {
		test(`${code} saves ${expected} day exit encashment at leap-year ${exit}`, async () => {
			const tables = createStatutoryWorld({
				code,
				period: PERIOD,
				region,
				companyFacts: {
					injury_rate: 0.2,
					housing_fund_rate: 7,
					housing_fund_supplementary_rate: 0,
					unemployment_employer_rate: 0.5,
					unemployment_employee_rate: 0.5
				},
				people: [
					{
						key: 'CN-LEAP',
						wage: 21750,
						worksite: code === 'CN-shanghai' ? 'SHANGHAI' : '云南省/昆明市/五华区',
						hire_date: HIRE,
						exit_date: exit,
						exit_ground: 'RESIGNATION',
						registrations: {
							PENSION: { kind: 'REGISTERED', elections: { contribution_base: 21750 } },
							HOUSING_FUND: { kind: 'REGISTERED', elections: { contribution_base: 21750 } }
						}
					}
				]
			});
			const employment = tables.employments[0];
			employment.exit_facts = { lcl_termination_ground: 'ART_37' };
			const row = leaveCatalogue(code).find(
				(r) => r.code === 'ANNUAL_LEAVE' && r.settings_id === settingsIdOn(code, exit)
			);
			tables.leave_catalogue.push(row);
			for (let offset = 1; offset <= 12; offset++) {
				const month = new Date(Date.UTC(2028, 2 - offset, 1)).toISOString().slice(0, 7);
				tables.payroll_runs.push({ id: `prior-${month}`, company_id: COMPANY_ID, period: month });
				tables.payslips.push({
					id: `paid-${month}`,
					payroll_run_id: `prior-${month}`,
					employment_id: employment.id,
					status: 'PAID',
					paid_at: `${month}-28T00:00:00.000Z`,
					currency: 'CNY',
					base: [{ component_code: 'BASIC', amount: 21750 }],
					adjustments: [],
					statutory: []
				});
			}
			const db = memoryDb(tables);
			const created = [];
			const settlement = await settleExit(
				{
					now: `${exit}T12:00:00.000Z`,
					today: exit,
					todayIn: () => exit,
					progress: async () => {},
					get: async () => employment,
					read: db.read,
					act: async (callable, input) => {
						if (callable === 'leave_entries.create') {
							const planned = await runTransform(leaveEntries, input, {
								tables,
								now: `${exit}T12:00:00.000Z`
							});
							created.push(
								...planned.map((entry, i) => ({ ...entry, id: `leave-${i}`, approval_id: null }))
							);
						}
						return { kind: 'committed', output: undefined, records: [] };
					}
				},
				employment.id
			);
			assert.equal(settlement.status, expected ? 'raised' : 'nothing_to_encash');
			assert.deepEqual(
				created.map((entry) => entry.encash_days),
				expected ? [expected] : []
			);
			tables.leave_entries.push(...created);
			const [saved] = await runTransform(
				payrollRuns,
				[{ company_id: COMPANY_ID, period: PERIOD }],
				{ tables }
			);
			const lines = saved.payslips.create[0].adjustments.filter(
				(entry) => entry.component_code === 'ANNUAL_LEAVE_ENCASHMENT'
			);
			assert.deepEqual(
				lines.map((entry) => entry.amount),
				expected ? [2000] : []
			);
		});
	}
}

test('absent a statutory divisor, calendar-day proration keeps the leap-year window length', () => {
	const rule = {
		availability: 'UPFRONT',
		proration: 'CALENDAR_DAYS',
		year_start_month: 1,
		rounding: 'WHOLE_DAY_DOWN',
		bands: [{ eligibility: '', days: 5 }]
	};
	const options = {
		rule,
		window: leaveWindowOf('2028-03-13', rule),
		asOf: '2028-03-13',
		hireDate: HIRE,
		exitDate: '2028-03-13',
		servedOn: () => true,
		eligibleOn: () => true,
		personOn: (asOf) =>
			personContext({ employee: null, employment: { service_start: HIRE }, terms: null, asOf })
	};
	assert.equal(computedEntitlement(options).available, 0);
	assert.equal(
		computedEntitlement({ ...options, rule: { ...rule, calendar_days_divisor: 365 } }).available,
		1
	);
});
