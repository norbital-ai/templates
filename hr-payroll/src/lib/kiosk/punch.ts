/** A person-day keeps its first arrival and latest explicitly confirmed departure. */
export type PunchInterval = Readonly<{ start: string; end: string | null }>;

export type PunchOutcome =
	| Readonly<{ kind: 'in' | 'out'; intervals: PunchInterval[]; index: number }>
	| Readonly<{
			kind: 'blocked';
			reason: 'cooldown' | 'already-in' | 'already-out' | 'no-open-interval';
			retryAfterMs?: number;
	  }>;

export const KIOSK_PUNCH_COOLDOWN_MS = 10_000;

export const nextPunch = (
	intervals: readonly PunchInterval[] | null,
	nowIso: string,
	lastMatchAtIso: string | null,
	direction: 'in' | 'out'
): PunchOutcome => {
	const first = intervals?.[0];
	if (direction === 'in' && first != null) return { kind: 'blocked', reason: 'already-in' };
	if (direction === 'out') {
		if (intervals == null || first == null) return { kind: 'blocked', reason: 'no-open-interval' };
		const index = intervals.length - 1;
		const last = intervals[index];
		if (last == null || nowIso <= (last.end ?? last.start))
			return { kind: 'blocked', reason: 'already-out' };
		return {
			kind: 'out',
			intervals: intervals.map((interval, i) =>
				i === index ? { ...interval, end: nowIso } : interval
			),
			index
		};
	}
	if (lastMatchAtIso !== null) {
		const gap = new Date(nowIso).getTime() - new Date(lastMatchAtIso).getTime();
		if (gap < KIOSK_PUNCH_COOLDOWN_MS)
			return { kind: 'blocked', reason: 'cooldown', retryAfterMs: KIOSK_PUNCH_COOLDOWN_MS - gap };
	}
	return { kind: 'in', intervals: [{ start: nowIso, end: null }], index: 0 };
};
