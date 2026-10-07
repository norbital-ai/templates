import { automation } from '@norbital-ai/bolt';
import { addDays } from '@norbital-ai/std/date';
import { Schema } from 'effect';
import { lateArrivalNotices, shiftVariantFrom } from '../lib/payroll_engine/late_arrival.js';
import { movementFromRow } from '../lib/payroll_engine/leave.js';

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
	const { rows: entries } = await ctx.read('roster_entry', {
		where: {
			approval_id: { isNull: true },
			work_date: { gte: since }
		},
		select: {
			id: true,
			employment_id: true,
			work_date: true,
			worked_intervals: true,
			shift_definition_id: true
		},
		all: true
	});
	const shiftIds = [
		...new Set(
			entries.flatMap((row) => (row.shift_definition_id == null ? [] : [row.shift_definition_id]))
		)
	];
	const shifts =
		shiftIds.length === 0
			? { rows: [] }
			: await ctx.read('shift_definition', {
					where: { id: { in: shiftIds } },
					select: { id: true, code: true, variant: true },
					all: true
				});
	const byShift = new Map(shifts.rows.map((row) => [row.id, row]));
	const employmentIds = [...new Set(entries.map((row) => row.employment_id))];
	const contracts =
		employmentIds.length === 0
			? { rows: [] }
			: await ctx.read('employment_contract', {
					where: { id: { in: employmentIds } },
					select: { id: true, employee_number: true, employee_id: true, company_id: true },
					all: true
				});
	const byContract = new Map(contracts.rows.map((row) => [row.id, row]));
	const employeeIds = [...new Set(contracts.rows.map((row) => row.employee_id))];
	const people =
		employeeIds.length === 0
			? { rows: [] }
			: await ctx.read('employment_profile', {
					where: { id: { in: employeeIds } },
					select: { id: true, name: true },
					all: true
				});
	const byPerson = new Map(people.rows.map((row) => [row.id, row]));
	const companyIds = [...new Set(contracts.rows.map((row) => row.company_id))];
	const entities =
		companyIds.length === 0
			? { rows: [] }
			: await ctx.read('entity', {
					where: { id: { in: companyIds } },
					select: { id: true, late_arrival_grace_minutes: true, time_zone: true },
					all: true
				});
	const byEntity = new Map(entities.rows.map((row) => [row.id, row]));
	const leave =
		employmentIds.length === 0
			? { rows: [] }
			: await ctx.read('leave_catalog_entry', {
					where: {
						employment_id: { in: employmentIds },
						activity: { eq: 'TIME_OFF' },
						approval_id: { isNull: true }
					},
					select: {
						id: true,
						catalog_id: true,
						employment_id: true,
						activity: true,
						occurred_on: true,
						approval_id: true,
						days: true,
						from: true,
						to: true
					},
					all: true
				});
	const candidates = entries.map((row) => {
		const contract = byContract.get(row.employment_id);
		const entity = contract == null ? undefined : byEntity.get(contract.company_id);
		const person = contract == null ? undefined : byPerson.get(contract.employee_id);
		const shift =
			row.shift_definition_id == null ? undefined : byShift.get(row.shift_definition_id);
		const grace = entity?.late_arrival_grace_minutes;
		return {
			roster_entry_id: row.id,
			employment_id: row.employment_id,
			work_date: String(row.work_date).slice(0, 10),
			worked_intervals: row.worked_intervals,
			shift: shiftVariantFrom(shift?.variant),
			grace_minutes: Schema.is(Schema.Number)(grace) ? grace : 15,
			time_zone: isString(entity?.time_zone) ? entity.time_zone : ctx.tz,
			employee_name: person?.name ?? '',
			employee_number: contract?.employee_number ?? '',
			shift_code: shift?.code ?? ''
		};
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
