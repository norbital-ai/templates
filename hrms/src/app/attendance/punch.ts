import type { Id, Row } from '@norbital-ai/bolt';
import type { PageContext } from '@norbital-ai/bolt/page';
import { Clock, DateTime, Effect } from 'effect';
/** What a punch answers: the half of the day it wrote, or why nothing was written. */
export type PunchResult = {
	readonly status: 'in' | 'out' | 'blocked';
	readonly kind: 'FACE' | 'MANUAL';
	readonly intervalIndex?: number;
	readonly time?: string;
	readonly cooldownMs?: number;
	readonly reason?: string;
	readonly retryAfterMs?: number;
	readonly plannedCode?: string;
};
/** One worked interval of the person-day, as the roster stores it. */
type Interval = NonNullable<Row<'roster_entry'>['actual_worked_intervals']>[number];
/** The window a second punch waits out, so one arrival is never written twice by a trailing frame. */
const PUNCH_COOLDOWN_MS = 60000;
/** A punch routed for approval, or one on a day an open approval already holds (`locked`), waits on that approval. */
const pending = (outcome: { readonly kind: string; readonly code?: string }) =>
	outcome.kind === 'pending_approval' || (outcome.kind === 'refused' && outcome.code === 'locked');
/**
 * One punch through `roster_entry`: the first punch of the day stores the arrival, every later one moves the
 * departure. The kiosk policy grants the model exactly those writes.
 */
export const punchWork = Effect.fnUntraced(function* (
	ctx: Pick<PageContext, 'query' | 'act'>,
	employment_id: Id<'employment'>,
	kind: 'FACE' | 'MANUAL'
) {
	const capturedAt = yield* Clock.currentTimeMillis;
	const assignment = yield* ctx.query({
			employment: {
				output: 'kiosk',
				where: { id: { eq: employment_id } },
				fields: ['entity_id'],
				limit: 1
			},
			entity: {
				output: 'kiosk',
				where: { employment: { some: { id: { eq: employment_id } } } },
				fields: ['settings_code', 'time_zone'],
				limit: 1
			}
		}),
		company = assignment.entity.rows[0],
		employment = assignment.employment.rows[0];
	if (company === undefined || employment === undefined)
		throw new Error('Assign the person to a legal employer before recording attendance.');
	const policies = yield* ctx.query({
		jurisdiction: {
			output: 'kiosk',
			where: { code: { eq: company.settings_code } },
			limit: 1
		}
	});
	const law = policies.jurisdiction.rows[0];
	if (law === undefined) throw new Error('Attendance requires the jurisdiction time zone.');
	const day = DateTime.formatIsoDate(
		DateTime.makeZonedUnsafe(capturedAt, { timeZone: company.time_zone ?? law.timezone })
	);
	const { roster_entry } = yield* ctx.query({
		roster_entry: {
			output: 'kiosk',
			where: { employment_id: { eq: employment_id }, work_date: { eq: day } },
			fields: ['actual_worked_intervals', 'employment_id', 'revision'],
			limit: 1
		}
	});
	const row = roster_entry.rows[0];
	const intervals = row?.actual_worked_intervals ?? [];
	const last = intervals.at(-1);
	const lastPunch = last == null ? undefined : Date.parse(last.end ?? last.start);
	const nowMs = yield* Clock.currentTimeMillis;
	if (lastPunch != null && Number.isFinite(lastPunch)) {
		const elapsed = nowMs - lastPunch;
		if (elapsed >= 0 && elapsed < PUNCH_COOLDOWN_MS)
			return {
				status: 'blocked' as const,
				kind,
				reason: 'cooldown',
				retryAfterMs: PUNCH_COOLDOWN_MS - elapsed
			};
	}
	const time = DateTime.formatIso(DateTime.makeUnsafe(nowMs));
	if (row == null) {
		const created = yield* ctx.act({
			'roster_entry.create': [
				{
					employment_id,
					work_date: day,
					actual_worked_intervals: [{ start: time, end: null }]
				}
			]
		});
		if (created.kind !== 'committed')
			return {
				status: 'blocked' as const,
				kind,
				reason: pending(created) ? 'pendingApproval' : 'refused'
			};
		return { status: 'in' as const, kind, intervalIndex: 0, time };
	}
	const next: Interval[] =
		intervals.length === 0 || last?.end != null
			? [...intervals, { start: time, end: null }]
			: intervals.map((interval, index) =>
					index === intervals.length - 1 ? { ...interval, end: time } : interval
				);
	const updated = yield* ctx.act({
		'roster_entry.update': [
			{ target: { id: row.id, revision: row.revision }, set: { actual_worked_intervals: next } }
		]
	});
	if (updated.kind !== 'committed')
		return {
			status: 'blocked' as const,
			kind,
			reason: pending(updated) ? 'pendingApproval' : 'refused'
		};
	return {
		status: intervals.length === 0 || last?.end != null ? ('in' as const) : ('out' as const),
		kind,
		intervalIndex: Math.max(0, next.length - 1),
		time
	};
});
