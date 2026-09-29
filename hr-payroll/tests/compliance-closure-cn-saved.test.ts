// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Compliance-closure saved-input/output probes, 2026-09-29 — China.
 *
 * The statutory goldens in `tests/statutory-golden-cn.test.ts` price these branches through
 * `gatherPayrollRun`/`buildPayrollRun`; these probes persist the same fixture through the
 * `payroll_runs` transform and assert the saved payslip, which is the production-probe evidence
 * the register rows CN-N02 and CN-N10 record as missing.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import payrollRuns from '../src/data/collection/payroll_runs/+collection.ts';
import {
	COMPANY_ID,
	createStatutoryWorld,
	leaveCatalogue,
	settingsIdOn
} from './fixtures/statutory-world.ts';
import { runTransform } from './helpers/ctx.ts';

const SH = 'CN-shanghai';
const PERIOD = '2026-01';
const SH_2026_FACTS = {
	injury_rate: 0.2,
	housing_fund_rate: 7,
	housing_fund_supplementary_rate: 0,
	unemployment_employer_rate: 0.5,
	unemployment_employee_rate: 0.5
};

function world(people) {
	return createStatutoryWorld({
		code: SH,
		period: PERIOD,
		region: 'SHANGHAI',
		companyFacts: SH_2026_FACTS,
		people
	});
}

const save = (tables) =>
	runTransform(payrollRuns, [{ company_id: COMPANY_ID, period: PERIOD }], { tables });

test('saved Shanghai payroll prices one unpaid day on the 21.75-day conversion (CN-N02)', async () => {
	// 人社部发〔2025〕2号: 月计薪天数 21.75, so 21,750 ÷ 21.75 = CNY1,000 a day (register CN-N02).
	const tables = world([
		{
			key: 'CN-N02',
			wage: 21_750,
			worksite: 'SHANGHAI',
			registrations: {
				PENSION: { kind: 'REGISTERED', elections: { contribution_base: 21_750 } },
				HOUSING_FUND: { kind: 'REGISTERED', elections: { contribution_base: 21_750 } }
			}
		}
	]);
	const row = leaveCatalogue(SH).find(
		(item) => item.code === 'UNPAID_LEAVE' && item.settings_id === settingsIdOn(SH, '2026-01-14')
	);
	assert.ok(row, 'a sealed UNPAID_LEAVE catalogue row covers 14 January 2026');
	tables.leave_catalogue.push(row);
	const employment = tables.employments[0];
	const term = tables.employment_terms[0];
	tables.leave_entries.push({
		id: 'e1000000-0000-4000-8000-000000000001',
		employment_id: employment.id,
		catalogue_id: row.id,
		leave_code: 'UNPAID_LEAVE',
		reference: 'NPL-1',
		from_date: '2026-01-14',
		to_date: '2026-01-14',
		half_day_start: false,
		half_day_end: false,
		days: 1,
		effective_on: '2026-01-14',
		reason: '事假',
		allocations: [],
		charges: [
			{
				date: '2026-01-14',
				days: 1,
				catalogue_id: row.id,
				employment_term_id: term.id,
				holiday_id: null,
				shift_definition_id: null,
				work_day_id: null
			}
		],
		approval_id: null
	});

	const [run] = await save(tables);
	const slip = run.payslips.create[0];
	assert.equal(slip.proration[0].denominator, 21.75, 'the pay month divides by 21.75');
	assert.deepEqual(
		slip.adjustments.map((entry) => [entry.bucket, entry.amount]),
		[['ABSENCE', 1000]]
	);
	assert.equal(slip.gross, 20_750);
});

test('saved Shanghai payroll taxes a separately elected annual bonus at ÷12 (CN-N10)', async () => {
	// STA 2018 No.61 annex: a qualifying annual bonus is taxed apart from the wage; 12,000 ÷ 12 =
	// 1,000 selects 3% → CNY360 (register CN-N10).
	const tables = world([
		{
			key: 'CN-N10',
			wage: 20_000,
			worksite: 'SHANGHAI',
			registrations: {
				PENSION: { kind: 'REGISTERED', elections: { contribution_base: 20_000 } },
				HOUSING_FUND: { kind: 'REGISTERED', elections: { contribution_base: 20_000 } }
			}
		}
	]);
	const employment = tables.employments[0];
	const bonus = tables.adhoc_catalogue.find(
		(item) =>
			item.code === 'ANNUAL_BONUS_SEPARATE' && item.settings_id === settingsIdOn(SH, '2026-01-10')
	);
	assert.ok(bonus, 'a sealed ANNUAL_BONUS_SEPARATE catalogue row covers 10 January 2026');
	tables.adhoc_requests.push({
		id: 'd0000000-0000-4000-8000-000000000001',
		employment_id: employment.id,
		catalogue_id: bonus.id,
		amount: 12_000,
		event_date: '2026-01-10',
		pay_period: null,
		payslip_id: null,
		reason: '2025 annual bonus',
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null
	});

	const [run] = await save(tables);
	const slip = run.payslips.create[0];
	const iitBonus = slip.statutory.find((charge) => charge.scheme_code === 'IIT_BONUS');
	assert.deepEqual([iitBonus.base_amount, iitBonus.employee_amount], [12_000, 360]);
});
