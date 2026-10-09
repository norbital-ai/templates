import { automation } from '@norbital-ai/bolt';
import { addDays } from '@norbital-ai/std/date';
import { Schema } from 'effect';
import { lateArrivalNotices, shiftVariantFrom } from '../lib/payroll_engine/late_arrival.js';
import { movementFromRow } from '../lib/payroll_engine/leave.js';
import { plainRows } from '../lib/payroll_engine/foundation.js';
import { type SettingsRow, zoneOn } from '../lib/payroll_engine/services.js';

const isString = Schema.is(Schema.String);

/**
 * Every five minutes, one in-app reminder per person-day to the production manager when a rostered WORK
 * shift has no clock-in after the entity’s late-arrival grace. Days covered by committed TIME_OFF are skipped.
 */
const late_arrival_notice = automation({
	description:
		'Every five minutes, one in-app reminder per person-day to the production manager when a rostered WORK shift has no clock-in after the entity’s late-arrival grace. Days covered by committed TIME_OFF are skipped.',
	on: { cron: '*/5 * * * *' },
	output: { kind: 'object', fields: { checked: { kind: 'int' }, reminded: { kind: 'int' } } },
	runAs: ['late_arrival_notice_automation'],
	concurrency: { max: 1 }
});
export default late_arrival_notice;

late_arrival_notice.run(async (_, ctx) => {
	const since = addDays(ctx.today, -2);
	// One read through the relations: each entity with its shifts and the contracts that have a recent roster day —
	// each with its person's name, its recent roster days and the time off reaching the window.
	const recent = { approval_id: { isNull: true }, work_date: { gte: since } } as const;
	const { rows: entities } = await ctx.read('entity', {
		select: {
			late_arrival_grace_minutes: true,
			settings_code: true,
			time_zone: true,
			shift_definition: { select: { code: true, variant: true }, all: true },
			employment_contract: {
				select: {
					employee_number: true,
					employee_id: { select: { name: true } },
					roster_entry: {
						select: {
							employment_id: true,
							work_date: true,
							worked_intervals: true,
							shift_definition_id: true
						},
						where: recent,
						all: true
					},
					leave_catalog_entry: {
						select: {
							catalog_id: true,
							employment_id: true,
							activity: true,
							occurred_on: true,
							approval_id: true,
							days: true,
							from: true,
							to: true
						},
						where: {
							activity: { eq: 'TIME_OFF' },
							approval_id: { isNull: true },
							or: [{ to: { gte: since } }, { occurred_on: { gte: since } }]
						},
						all: true
					}
				},
				where: { roster_entry: { some: recent } },
				all: true
			}
		},
		all: true
	});
	// An entity without a zone counts its shifts in its version's `payroll.timezone`: one read of those lineages.
	const codes = [
		...new Set(entities.filter((entity) => !isString(entity.time_zone)).map((e) => e.settings_code))
	];
	const versions =
		codes.length === 0
			? []
			: plainRows<SettingsRow>(
					(
						await ctx.read('jurisdiction_settings', {
							select: {
								code: true,
								approval_id: true,
								sealed_at: true,
								voided_at: true,
								effective_range: true,
								payroll: true
							},
							where: {
								code: { in: codes },
								approval_id: { isNull: true },
								sealed_at: { isNull: false },
								voided_at: { isNull: true }
							},
							all: true
						})
					).rows
				);
	const leave = {
		rows: entities.flatMap((entity) =>
			entity.employment_contract.flatMap((contract) => contract.leave_catalog_entry)
		)
	};
	const entries = entities.flatMap((entity) =>
		entity.employment_contract.flatMap((contract) => contract.roster_entry)
	);
	const candidates = entities.flatMap((entity) => {
		const byShift = new Map(entity.shift_definition.map((row) => [row.id, row]));
		const grace = entity.late_arrival_grace_minutes;
		return entity.employment_contract.flatMap((contract) =>
			contract.roster_entry.map((row) => {
				const shift =
					row.shift_definition_id == null ? undefined : byShift.get(row.shift_definition_id);
				return {
					roster_entry_id: row.id,
					employment_id: row.employment_id,
					work_date: String(row.work_date).slice(0, 10),
					worked_intervals: row.worked_intervals,
					shift: shiftVariantFrom(shift?.variant),
					grace_minutes: Schema.is(Schema.Number)(grace) ? grace : 15,
					time_zone: zoneOn(entity, versions, String(ctx.today)),
					employee_name: contract.employee_id?.name ?? '',
					employee_number: contract.employee_number ?? '',
					shift_code: shift?.code ?? ''
				};
			})
		);
	});
	const notices = lateArrivalNotices({
		now_ms: Date.parse(String(ctx.now)),
		lookback_ms: 6 * 3_600_000,
		candidates,
		leave: leave.rows.map(movementFromRow)
	});
	if (notices.length > 0)
		await ctx.notify(
			notices.map((notice) => ({
				to: { team: 'Production Manager' as const },
				once: notice.once,
				link: {
					collection: 'roster_entry' as const,
					id: notice.roster_entry_id
				},
				title: notice.title,
				body: notice.body
			}))
		);
	return { checked: entries.length, reminded: notices.length };
});
