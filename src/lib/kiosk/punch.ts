/**
 * The kiosk interval state machine: one punch toggles or sets the day's last interval.
 *
 * Pure — no dates constructed, no I/O — so the template's punch tests pin it directly and the
 * server function only supplies `now` and the stored row. `end: null` is an open span; a null
 * row is a day with no attendance recorded at all.
 */
export type PunchInterval = Readonly<{
	start: string;
	end: string | null;
}>;

export type PunchOutcome =
	| Readonly<{ kind: 'in'; intervals: PunchInterval[]; index: number }>
	| Readonly<{ kind: 'out'; intervals: PunchInterval[]; index: number }>
	| Readonly<{
			kind: 'blocked';
			reason: 'cooldown' | 'already-in' | 'no-open-interval';
			retryAfterMs?: number;
	  }>;

/** Minimum gap between two accepted punches for one person. */
export const KIOSK_PUNCH_COOLDOWN_MS = 10_000;

export const nextPunch = (
	intervals: readonly PunchInterval[] | null,
	nowIso: string,
	lastMatchAtIso: string | null,
	direction: 'toggle' | 'in' | 'out'
): PunchOutcome => {
	if (lastMatchAtIso !== null) {
		const gap = new Date(nowIso).getTime() - new Date(lastMatchAtIso).getTime();
		if (gap < KIOSK_PUNCH_COOLDOWN_MS) {
			return { kind: 'blocked', reason: 'cooldown', retryAfterMs: KIOSK_PUNCH_COOLDOWN_MS - gap };
		}
	}
	const open =
		intervals !== null && intervals.length > 0 && intervals[intervals.length - 1]?.end == null;
	if (direction === 'toggle') {
		if (open) {
			const index = (intervals?.length ?? 1) - 1;
			return {
				kind: 'out',
				intervals: (intervals ?? []).map((interval, i) =>
					i === index ? { ...interval, end: nowIso } : interval
				),
				index
			};
		}
		return {
			kind: 'in',
			intervals: [...(intervals ?? []), { start: nowIso, end: null }],
			index: intervals?.length ?? 0
		};
	}
	if (direction === 'in') {
		if (open) return { kind: 'blocked', reason: 'already-in' };
		return {
			kind: 'in',
			intervals: [...(intervals ?? []), { start: nowIso, end: null }],
			index: intervals?.length ?? 0
		};
	}
	if (!open) return { kind: 'blocked', reason: 'no-open-interval' };
	const index = (intervals?.length ?? 1) - 1;
	return {
		kind: 'out',
		intervals: (intervals ?? []).map((interval, i) =>
			i === index ? { ...interval, end: nowIso } : interval
		),
		index
	};
};
