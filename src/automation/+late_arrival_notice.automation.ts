import { automation } from '@norbital-ai/bolt';
import { Instant, PlainDate } from '@norbital-ai/std/date';
import { lateArrivals, lateArrivalSpan } from '../lib/late-arrival.js';
import { plainRows } from '../lib/wire.js';

/**
 * Late for work: a rostered shift whose clock-in never came, reminded once per person-day to the production
 * manager. Not a gate: it refuses nothing and seals nothing. It reads committed rows only, so a held leave entry
 * excuses nothing and a held clock-in does not count.
 *
 * Each run sends what is due and schedules itself for the next shift start plus the grace (one queued run under
 * the key `late_arrival`, replaced by every re-plan). The midnight slot starts each day's chain; a roster or
 * shift change re-plans at once. A settings seal fires nothing, so a zone change takes effect at the next run.
 */
const late_arrival_notice = automation({
	description:
		'Finds the rostered shifts whose company grace (fifteen minutes by default) has passed with no clock-in and reminds the production manager, once per person-day. A day covered by approved leave is never a late arrival.',
	on: [
		{ cron: '0 0 * * *' },
		{ created: 'work_days' },
		{ updated: 'work_days', fields: ['shift_definition_id'] },
		{ updated: 'shift_definitions', fields: ['variant', 'effective_range'] },
		{ updated: 'companies', fields: ['settings_code'] }
	],
	output: {
		kind: 'object',
		fields: { reminded: { kind: 'int' }, next: { kind: 'instant', optional: true } }
	},
	runAs: ['late_arrival_notice_automation'],
	concurrency: { max: 1 }
});
export default late_arrival_notice;

late_arrival_notice.run(async (_input, ctx) => {
	const now = new Date(String(ctx.now));
	const settled = { approval_id: { isNull: true } } as const;
	const [companies, versions, shifts, employments] = await Promise.all([
		ctx.read('companies', {
			where: settled,
			select: { name: true, settings_code: true, late_arrival_grace_minutes: true },
			all: true
		}),
		ctx.read('jurisdiction_settings', {
			select: {
				code: true,
				sealed_at: true,
				voided_at: true,
				approval_id: true,
				effective_range: true,
				payroll: true
			},
			all: true
		}),
		ctx.read('shift_definitions', { select: { variant: true, effective_range: true }, all: true }),
		ctx.read('employments', {
			where: settled,
			select: { employee_id: true, employee_number: true, company_id: true, effective_range: true },
			all: true
		})
	]);
	const span = lateArrivalSpan(now);
	const ids = employments.rows.map((row) => row.id);
	const [workDays, timeOff, employees] = await Promise.all([
		ctx.read('work_days', {
			where: {
				...settled,
				employment_id: { in: ids },
				work_date: { gte: PlainDate(span.from), lte: PlainDate(span.to) }
			},
			select: {
				employment_id: true,
				work_date: true,
				shift_definition_id: true,
				worked_intervals: true
			},
			all: true
		}),
		ctx.read('leave_entries', {
			where: {
				...settled,
				activity: { eq: 'TIME_OFF' },
				employment_id: { in: ids },
				from_date: { lte: PlainDate(span.to) },
				to_date: { gte: PlainDate(span.from) }
			},
			select: {
				employment_id: true,
				from_date: true,
				to_date: true,
				half_day_start: true,
				half_day_end: true
			},
			all: true
		}),
		ctx.read('employees', {
			where: {
				...settled,
				id: { in: [...new Set(employments.rows.map((row) => row.employee_id))] }
			},
			select: { name: true },
			all: true
		})
	]);
	const { due, next } = lateArrivals(
		{
			companies: plainRows(companies),
			versions: plainRows(versions),
			shifts: plainRows(shifts),
			employments: plainRows(employments),
			names: new Map(employees.rows.map((row) => [row.id, row.name])),
			workDays: plainRows(workDays),
			timeOff: plainRows(timeOff)
		},
		now
	);
	if (due.length > 0)
		await ctx.notify(
			due.map((late) => ({
				to: { team: 'Production Manager' },
				title: `Late for work — ${late.company}`,
				body: late.body,
				once: late.once
			}))
		);
	const at = next == null ? null : Instant(new Date(next));
	if (at != null) await ctx.schedule('late_arrival_notice', {}, { at, key: 'late_arrival' });
	return { reminded: due.length, next: at };
});
