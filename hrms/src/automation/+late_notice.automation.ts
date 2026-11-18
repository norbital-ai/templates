import { automation } from '@norbital-ai/bolt';
import { DateTime, Effect } from 'effect';
import { LATE_NOTICE_POLICIES } from '../lib/company.js';
import { scheduled } from '../lib/payroll_engine/attendance.js';
import { isJsonObject, type Json, type JsonObject } from '../lib/payroll_engine/foundation.js';
import { idOf, idsOf, queryRows, valueText } from '../lib/payroll_engine/reads.js';

const notifiable = (value: Json): value is (typeof LATE_NOTICE_POLICIES)[number] =>
	LATE_NOTICE_POLICIES.some((policy) => policy === value);

/**
 * A late clock-in tells the people its company names. When the first clock-in of a rostered work day is the company's
 * `late_notice_minutes` or more past the shift's start, everyone holding one of its `late_notice_policies` is notified,
 * once per day, for a day of today or yesterday. A company with no minutes set notifies no one. It listens to roster saves and runs under
 * `payroll_execution`: a kiosk punch cannot read the shift it is late for.
 */
export default automation({
	description:
		'Notify the people a company names when someone clocks in late for a rostered shift; once per day.',
	on: [{ model: 'roster_entry', verbs: ['create', 'update'] }],
	policies: ['payroll_execution'],
	run: function* (_, ctx) {
		const trigger = ctx.trigger;
		if (trigger.kind !== 'system' || trigger.cause !== 'event' || trigger.records.length === 0)
			return;
		// a live alert: only today's and yesterday's days, so a payroll run sealing a month or an imported past roster
		// announces nothing; a write may touch more days than one read may name
		const yesterday = DateTime.formatIsoDate(
			DateTime.subtract(DateTime.makeUnsafe(ctx.today), { days: 1 })
		);
		const ids = idsOf('roster_entry', trigger.records);
		const days = (yield* Effect.forEach(
			Array.from({ length: Math.ceil(ids.length / 1000) }, (_, n) =>
				ids.slice(n * 1000, n * 1000 + 1000)
			),
			(batch) =>
				queryRows(ctx.query, {
					roster_entry: {
						where: { id: { in: batch }, work_date: { gte: yesterday } },
						fields: ['id', 'work_date', 'actual_worked_intervals'],
						limit: 1000,
						shift_definition_id: { fields: ['variant'] },
						employment_id: { fields: ['employee_number', 'employee_id', 'entity_id'] }
					}
				}),
			{ concurrency: 'unbounded' }
		)).flatMap((got) => got.roster_entry);
		const clocked = days.filter(
			(row) =>
				isJsonObject(row.shift_definition_id) &&
				Array.isArray(row.actual_worked_intervals) &&
				row.actual_worked_intervals.length > 0
		);
		if (clocked.length === 0) return;
		const EMPTY: JsonObject = {};
		const stintOf = (row: (typeof days)[number]): JsonObject =>
			isJsonObject(row.employment_id) ? row.employment_id : EMPTY;
		// the companies, people and zones those days answer to: one trip
		const got = yield* queryRows(ctx.query, {
			entity: {
				where: {
					id: {
						in: idsOf(
							'entity',
							clocked.map((row) => stintOf(row).entity_id)
						)
					}
				},
				fields: ['id', 'settings_code', 'time_zone', 'late_notice_minutes', 'late_notice_policies'],
				limit: 10000
			},
			employee_profile: {
				where: {
					id: {
						in: idsOf(
							'employee_profile',
							clocked.map((row) => stintOf(row).employee_id)
						)
					}
				},
				fields: ['id', 'name'],
				limit: 10000
			},
			jurisdiction: { fields: ['code', 'timezone'], limit: 1000 }
		});
		const companies = new Map(got.entity.map((row) => [valueText(row, 'id'), row]));
		const names = new Map(
			got.employee_profile.map((row) => [valueText(row, 'id'), valueText(row, 'name')])
		);
		const zones = new Map(
			got.jurisdiction.map((row) => [valueText(row, 'code'), valueText(row, 'timezone')])
		);
		const notices = clocked.flatMap((row) => {
			const stint = stintOf(row);
			const company: JsonObject = companies.get(valueText(stint, 'entity_id')) ?? EMPTY;
			const minutes =
				typeof company.late_notice_minutes === 'number' ? company.late_notice_minutes : 0;
			const policies = Array.isArray(company.late_notice_policies)
				? company.late_notice_policies.filter(notifiable)
				: [];
			const shift = isJsonObject(row.shift_definition_id) ? row.shift_definition_id : undefined;
			const zone =
				valueText(company, 'time_zone') || zones.get(valueText(company, 'settings_code'));
			if (minutes <= 0 || policies.length === 0 || shift === undefined || !zone) return [];
			const plan = scheduled(row, { zone, shift });
			const start = plan.spans[0]?.start;
			const clockIn = (
				Array.isArray(row.actual_worked_intervals) ? row.actual_worked_intervals : []
			)
				.flatMap((span) =>
					isJsonObject(span) && typeof span.start === 'string'
						? [DateTime.toEpochMillis(DateTime.makeUnsafe(span.start))]
						: []
				)
				.toSorted((left, right) => left - right)[0];
			if (plan.day_type !== 'WORK' || start === undefined || clockIn === undefined) return [];
			const late = Math.floor((clockIn - start) / 60_000);
			if (late < minutes) return [];
			const number = valueText(stint, 'employee_number');
			const person = names.get(valueText(stint, 'employee_id')) || number;
			return [
				{
					title: `${person} clocked in ${late} minutes late`,
					description: `${number}, the shift of ${valueText(row, 'work_date')}.`,
					to: policies.map((policy) => ({ policy })),
					link: { model: 'roster_entry' as const, id: idOf('roster_entry', row.id) },
					once: `late:${valueText(row, 'id')}`
				}
			];
		});
		if (notices.length > 0) yield* ctx.notify(notices);
	}
});
