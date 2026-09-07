/**
 * What one punch does to a person-day.
 *
 * The kiosk used to ask which direction to punch, and `nextPunch` refused the answer whenever it
 * contradicted the day: "already checked in", "check in first". The clock already knew — the day
 * keeps its first arrival and its latest departure, and which of the two a punch is is a fact of
 * what is already stored, not a question for the person standing at the tablet. So there is no
 * direction: the first punch of the day opens the interval, and every later one moves its end. The
 * last punch of the day is the departure by construction, and a person who punches once more on
 * the way back from lunch has simply moved their departure later, which the next punch corrects.
 *
 * The three contradiction refusals went with the question. What is left is the cooldown, which is
 * not a contradiction but a debounce: a face held in front of the camera is one arrival, not forty.
 */
export type PunchInterval = Readonly<{ start: string; end: string | null }>;

/**
 * Every way a punch can fail to happen, in one place.
 *
 * `nextPunch` decides `cooldown`; the command decides the two schedule reasons, because only it can
 * see the day's plan. They belong in the same union anyway — the screen and the narrator switch on
 * this one value, and a reason minted somewhere else is a reason they would silently fall through
 * to "Nothing changed" on.
 */
export type PunchBlockedReason = 'cooldown' | 'not-scheduled' | 'not-a-work-day';

export type PunchOutcome =
	| Readonly<{ kind: 'in' | 'out'; intervals: PunchInterval[]; index: number }>
	| Readonly<{ kind: 'blocked'; reason: 'cooldown'; retryAfterMs: number }>;

export const KIOSK_PUNCH_COOLDOWN_MS = 10_000;

/**
 * What the kiosk *says* for a blocked punch — the reason mapped to a narration key, and nothing
 * else. The screen carries the specifics (which roster code the day holds, how many seconds to
 * wait); this only picks the sentence.
 *
 * It lives here rather than in the kiosk page because it is a property of the reasons, and because
 * a mapping inside a `.svelte` module is a mapping nothing can test. The failure it guards is
 * silent: an unmapped reason falls through to `unchanged` — "Nothing changed" — said to someone who
 * is simply not rostered today, which is what this kiosk did until the schedule gate landed.
 */
export const blockedPhraseKey = (
	reason: string | undefined
): 'too_soon' | 'no_shift_today' | 'unchanged' => {
	if (reason === 'cooldown') return 'too_soon';
	if (reason === 'not-scheduled' || reason === 'not-a-work-day') return 'no_shift_today';
	return 'unchanged';
};

export const nextPunch = (
	intervals: readonly PunchInterval[] | null,
	nowIso: string,
	lastMatchAtIso: string | null
): PunchOutcome => {
	if (lastMatchAtIso !== null) {
		const gap = new Date(nowIso).getTime() - new Date(lastMatchAtIso).getTime();
		if (gap < KIOSK_PUNCH_COOLDOWN_MS)
			return { kind: 'blocked', reason: 'cooldown', retryAfterMs: KIOSK_PUNCH_COOLDOWN_MS - gap };
	}
	const first = intervals?.[0];
	if (intervals == null || first == null)
		return { kind: 'in', intervals: [{ start: nowIso, end: null }], index: 0 };
	const index = intervals.length - 1;
	const last = intervals[index];
	// A punch that would close an interval before it opened is a clock the day cannot represent.
	// It leaves the day exactly as it was rather than recording a negative one.
	if (last == null || nowIso < last.start)
		return { kind: 'blocked', reason: 'cooldown', retryAfterMs: 0 };
	return {
		kind: 'out',
		intervals: intervals.map((interval, i) =>
			i === index ? { ...interval, end: nowIso } : interval
		),
		index
	};
};
