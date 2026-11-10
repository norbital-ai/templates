import { describe, it } from '@effect/vitest';
import type { JsonObject } from '../src/lib/payroll_engine/contracts.js';
import { calculatePayroll, type PayrollInput } from '../src/lib/payroll_engine/engine.js';

const off = [0, 6];
const days = (from: string, to: string) => {
	const out: { date: string; work: boolean }[] = [];
	const start = Date.parse(`${from}T00:00:00Z`),
		end = Date.parse(`${to}T00:00:00Z`);
	for (let at = start; at <= end; at += 86_400_000) {
		const date = new Date(at).toISOString().slice(0, 10);
		out.push({ date, work: !off.includes(new Date(`${date}T00:00:00Z`).getUTCDay()) });
	}
	return out;
};
const settings: JsonObject = {
	code: 'MY',
	conversions: {
		day: { basis: 'FIXED', days: 26 },
		hour: { basis: 'CONTRACT_HOURS' },
		proration: 'CALENDAR_DAYS',
		rounding: { mode: 'HALF_UP', scale: 2 }
	},
	ledger: { ytd_scope: 'JURISDICTION' }
};
const run = (projected: readonly { date: string; work: boolean }[]) => {
	const input: PayrollInput = {
		run: {
			id: 'run',
			entity_id: 'entity',
			pay_date: '2026-01-25',
			salary_coverage: { from: '2026-01-01', to: '2026-01-31' }
		},
		settings,
		subtotals: [{ id: 'base', code: 'BASE', name: 'BASE', previous_id: null, settings_id: 'my' }],
		allowance: [],
		overtime: [],
		statutory: [],
		leave_catalog: [{ id: 'leave', code: 'UNPAID_LEAVE', settings_id: 'my', paid_share: '0' }],
		claim_catalog: [],
		adhoc_catalog: [],
		loan_catalog: [],
		employee: {},
		employment: {
			id: 'contract',
			terms: {
				rate: { amount: 3937, unit: 'MONTHLY' },
				normal_hours_per_day: 8,
				normal_hours_per_week: 40,
				normal_days_per_week: 5
			}
		},
		employer: { payment_schedule: { frequency: 'MONTHLY', non_working_weekdays: [] } },
		balance: { account: {} },
		entries: {
			leave_catalog_entry: [
				{
					id: 'entry',
					catalog_id: 'leave',
					days: [
						{ date: '2025-12-23', part: 'AM' },
						{ date: '2025-12-23', part: 'PM' },
						{ date: '2025-12-31', part: 'AM' },
						{ date: '2025-12-31', part: 'PM' }
					]
				}
			]
		},
		work: { days: [] },
		projected_days: projected
	};
	const result = calculatePayroll(input);
	return { base: result.subtotals[0]?.value, lines: result.lines.length };
};

describe('npl probe', () => {
	it('prints the base for two projected ranges', () => {
		console.log('full', run(days('2025-12-21', '2026-01-31')));
		console.log('january', run(days('2026-01-01', '2026-01-31')));
	});
});
