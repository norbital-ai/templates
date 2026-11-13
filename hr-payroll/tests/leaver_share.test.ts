// A leaver on a shift pattern is paid the share of the period they were employed: the days after they leave are still
// working days of the period, unpaid.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { ENTITY, OFF, REST, WORK, pack, storedQuery, uuid, workspace } from './kit.ts';

const PATTERN = uuid(950);
const terms = {
	rate: { amount: 6600, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {},
	shift_pattern_id: PATTERN
};
const base = pack('SG', 'Asia/Singapore', terms, { race: 'CHINESE' }, [], [], '2026-06-15');
const seed = {
	...base,
	shift_pattern: [
		{
			id: PATTERN,
			entity_id: ENTITY,
			code: 'WEEKDAYS',
			name: 'Weekdays',
			effective_range: { from: '2026-01-01', to: null },
			pattern: {
				week_start: 'MONDAY',
				days: {
					MONDAY: WORK,
					TUESDAY: WORK,
					WEDNESDAY: WORK,
					THURSDAY: WORK,
					FRIDAY: WORK,
					SATURDAY: REST,
					SUNDAY: OFF
				}
			}
		}
	],
	employee_contract: (base.employee_contract ?? []).map((row) => ({
		...row,
		effective_range: { from: '2026-01-01', to: '2026-06-15' }
	}))
};

describe('a leaver on a shift pattern', () => {
	it.live('is paid the working days employed, not the whole period', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			yield* admin.act({
				'payroll_run.create': [{ entity_id: ENTITY, period: '2026-06', kind: 'ON_CYCLE' }]
			});
			const [slip] = (yield* storedQuery(t, { payslip: { limit: 1 } })).payslip.rows;
			// BASIC is the contract salary; PRORATED is what the days employed leave of it
			assert.equal(slip?.basic_earnings?.to_number(), terms.rate.amount);
			const { checkpoints } = Schema.decodeUnknownSync(PayslipBreakdown)(slip?.breakdown);
			// June 2026 has 22 weekdays; the 1st to the 15th hold 11 of them
			assert.equal(
				checkpoints.find((point) => point.code === 'PRORATED')?.value,
				(terms.rate.amount * 11) / 22
			);
		}).pipe(Effect.provide(workspace({ seed, now: '2026-06-20T02:00:00.000Z' })))
	);
});
