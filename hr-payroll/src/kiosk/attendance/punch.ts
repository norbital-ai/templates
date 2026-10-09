import type { Id } from '@norbital-ai/bolt';
import { Instant } from '@norbital-ai/std/date';
import { Schema } from 'effect';
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
type Interval = { readonly start: Instant; readonly end: Instant | null };

/** The window a second punch waits out, so one arrival is never written twice by a trailing frame. */
const PUNCH_COOLDOWN_MS = 60_000;

const StoredIntervals = Schema.Array(
	Schema.Struct({ start: Schema.String, end: Schema.optional(Schema.NullOr(Schema.String)) })
);

const readIntervals = (value: unknown): Interval[] =>
	Schema.is(StoredIntervals)(value)
		? value.map((row) => ({
				start: Instant(row.start),
				end: row.end == null ? null : Instant(row.end)
			}))
		: [];

/**
 * One punch through `roster_entry`: the first punch of the day stores the arrival, every later one moves the
 * departure. The kiosk policy grants the collection exactly those writes.
 */
export async function punchWork(
	employment_id: Id<'employment_contract'>,
	kind: 'FACE' | 'MANUAL'
): Promise<PunchResult> {
	const day = todayKey();
	const answer = await bolt.read('roster_entry', {
		where: { employment_id: { eq: employment_id }, work_date: { eq: day } },
		select: { id: true, worked_intervals: true },
		limit: 1
	});
	const row = answer.rows[0];
	const intervals = readIntervals(row?.worked_intervals);
	const last = intervals.at(-1);
	const lastPunch = last == null ? undefined : Date.parse(last.end ?? last.start);
	const nowMs = Date.now();
	if (lastPunch != null && Number.isFinite(lastPunch)) {
		const elapsed = nowMs - lastPunch;
		if (elapsed >= 0 && elapsed < PUNCH_COOLDOWN_MS)
			return {
				status: 'blocked',
				kind,
				reason: 'cooldown',
				retryAfterMs: PUNCH_COOLDOWN_MS - elapsed
			};
	}
	const time = Instant(new Date(nowMs).toISOString());
	if (row == null) {
		const created = await bolt.act('roster_entry.create', {
			employment_id,
			work_date: day,
			worked_intervals: [{ start: time, end: null }]
		});
		if (created.kind !== 'committed' && created.kind !== 'pendingApproval')
			return { status: 'blocked', kind, reason: 'refused' };
		return { status: 'in', kind, intervalIndex: 0, time };
	}
	const next: Interval[] =
		intervals.length === 0
			? [{ start: time, end: null }]
			: intervals.map((interval, index) =>
					index === intervals.length - 1 ? { ...interval, end: time } : interval
				);
	const updated = await bolt.act('roster_entry.update', {
		target: row.id,
		set: { worked_intervals: next }
	});
	if (updated.kind !== 'committed' && updated.kind !== 'pendingApproval')
		return { status: 'blocked', kind, reason: 'refused' };
	return {
		status: intervals.length === 0 ? 'in' : 'out',
		kind,
		intervalIndex: Math.max(0, next.length - 1),
		time
	};
}
