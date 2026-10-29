import type { Id, Row } from '@norbital-ai/bolt';
import { Instant } from '@norbital-ai/std/date';
import { Clock, Effect } from 'effect';
import { bolt } from '$bolt';
import { todayKey } from '../../lib/ui/format/calendar.js';
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
type Interval = NonNullable<Row<'roster_entry'>['worked_intervals']>[number];
/** The window a second punch waits out, so one arrival is never written twice by a trailing frame. */
const PUNCH_COOLDOWN_MS = 60000;
/** A punch routed for approval, or one on a day an open approval already holds (`locked`), waits on that approval. */
const pending = (outcome: { readonly kind: string; readonly code?: string }) =>
	outcome.kind === 'pendingApproval' || (outcome.kind === 'refused' && outcome.code === 'locked');
/**
 * One punch through `roster_entry`: the first punch of the day stores the arrival, every later one moves the
 * departure. The kiosk policy grants the model exactly those writes.
 */
export const punchWork = Effect.fnUntraced(function* (
	employment_id: Id<'employment_contract'>,
	kind: 'FACE' | 'MANUAL'
) {
	const day = todayKey(new Date(yield* Clock.currentTimeMillis));
	const { roster_entry } = yield* bolt.query({
		roster_entry: {
			output: 'kiosk',
			where: { employment_id: { eq: employment_id }, work_date: { eq: day } },
			fields: ['worked_intervals'],
			limit: 1
		}
	});
	const row = roster_entry.rows[0];
	const intervals = row?.worked_intervals ?? [];
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
	const time = Instant(new Date(nowMs).toISOString());
	if (row == null) {
		const created = yield* bolt.act('roster_entry.create', [
			{ employment_id, work_date: day, worked_intervals: [{ start: time, end: null }] }
		]);
		if (created.kind !== 'committed')
			return {
				status: 'blocked' as const,
				kind,
				reason: pending(created) ? 'pendingApproval' : 'refused'
			};
		return { status: 'in' as const, kind, intervalIndex: 0, time };
	}
	const next: Interval[] =
		intervals.length === 0
			? [{ start: time, end: null }]
			: intervals.map((interval, index) =>
					index === intervals.length - 1 ? { ...interval, end: time } : interval
				);
	const updated = yield* bolt.act('roster_entry.update', [
		{ target: row.id, set: { worked_intervals: next } }
	]);
	if (updated.kind !== 'committed')
		return {
			status: 'blocked' as const,
			kind,
			reason: pending(updated) ? 'pendingApproval' : 'refused'
		};
	return {
		status: intervals.length === 0 ? ('in' as const) : ('out' as const),
		kind,
		intervalIndex: Math.max(0, next.length - 1),
		time
	};
});
