/** A time-off range charges what the server counts on the employment's own plan, in the class's unit. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { requestDays } from '../src/lib/payroll_engine/leave_days.ts';
import type { HostRead } from '../src/lib/payroll_engine/foundation.ts';

const shift = (id: string, day_type: string) => ({
	id,
	company_id: 'c1',
	code: id,
	variant: { day_type, start_time: '09:00', end_time: '18:00', break_minutes: 60 }
});
const reader = (patternId: string | null): HostRead => {
	const tables: Record<string, readonly { id?: string }[]> = {
		entity: [{ id: 'c1' }],
		employment_contract: [
			{
				id: 'k1',
				company_id: 'c1',
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2020-01-01', to: null },
							base_salary: { value: 1, currency: 'SGD' },
							...(patternId == null ? {} : { shift_pattern_id: patternId })
						}
					]
				}
			} as { id: string }
		],
		leave_catalog: [
			{ id: 'day', unit: 'DAY' },
			{ id: 'calendar', unit: 'CALENDAR_DAY' },
			{ id: 'hour', unit: 'HOUR' }
		] as { id: string }[],
		roster_entry: [
			{ employment_id: 'k1', work_date: '2026-03-07', shift_definition_id: 'W' }
		] as object[],
		shift_definition: [shift('W', 'WORK'), shift('R', 'REST'), shift('O', 'OFF')],
		// A Monday-anchored week: five working days, a rest day and an off day.
		shift_pattern: [
			{
				id: 'p1',
				company_id: 'c1',
				effective_range: { from: '2026-03-02', to: null },
				pattern: { days: ['W', 'W', 'W', 'W', 'W', 'R', 'O'].map((id) => ({ roster_code_id: id })) }
			}
		],
		holiday: [{ company_id: 'c1', date: '2026-03-04' }] as object[]
	};
	// `eq` and `in` on keys the rows carry: an entity's or employment's rows by their key (the read's relation arms).
	const keyed = ['id', 'company_id', 'employment_id'];
	return (async (
		collection: string,
		query: { where?: Record<string, { eq?: unknown; in?: unknown[] }> }
	) => ({
		rows: (tables[collection] ?? []).filter((row) =>
			Object.entries(query.where ?? {}).every(([key, clause]) => {
				if (!keyed.includes(key)) return true;
				const value = (row as Record<string, unknown>)[key];
				return clause.in != null
					? clause.in.includes(value)
					: clause.eq == null || value === clause.eq;
			})
		)
	})) as unknown as HostRead;
};
const count = (catalog_id: string, extra: object = {}, patternId: string | null = 'p1') =>
	requestDays(
		{ employment_id: 'k1', catalog_id, from: '2026-03-02', to: '2026-03-08', ...extra },
		reader(patternId)
	);

describe('leave days', () => {
	it('charges the planned working days less published holidays, the roster day winning over the pattern', async () => {
		// Mon–Fri less Wednesday's holiday, plus the Saturday rostered to work; Sunday is off.
		assert.deepEqual(await count('day'), {
			days: 5,
			unit: 'DAY',
			off: ['2026-03-04', '2026-03-08']
		});
		assert.equal(((await count('day', { half_day_start: true })) as { days: number }).days, 4.5);
	});

	it('a calendar-day class charges every day, an hour class the scheduled hours', async () => {
		assert.deepEqual(await count('calendar'), { days: 7, unit: 'CALENDAR_DAY', off: [] });
		assert.equal(((await count('hour')) as { days: number }).days, 40);
		assert.equal(((await count('hour', { half_day_end: true })) as { days: number }).days, 36);
	});

	it('nothing planned charges the calendar days less published holidays; hours need a plan; a reversed range refuses', async () => {
		// Without a pattern only the rostered Saturday is planned; a range with no plan at all charges its days, less
		// Wednesday's published holiday.
		assert.equal(((await count('day', {}, null)) as { days: number }).days, 1);
		const unplanned = { to: '2026-03-06' };
		assert.deepEqual(await count('day', unplanned, null), {
			days: 4,
			unit: 'DAY',
			off: ['2026-03-04']
		});
		assert.equal(typeof (await count('hour', unplanned, null)), 'string');
		assert.equal(typeof (await count('day', { to: '2026-03-01' })), 'string');
	});
});
