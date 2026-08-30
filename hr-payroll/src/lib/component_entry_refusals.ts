import { Result, Schema } from 'effect';
import { componentEntryEventSchema } from '../datatypes/component_entry_event/+definition.js';

/**
 * ============================================================================
 * THE ARM RULE THE COLUMNS CANNOT STATE
 * ============================================================================
 *
 * `component_entries` carries five event arms, and each arm uses some of the row's optional
 * columns and not the others. The union states the arm payload; the rule below states which
 * optional columns each arm may and must carry:
 *
 *     A RULE THE DATABASE CANNOT STATE IS A NAMED REFUSAL, NOT A COMMENT.
 *
 * It is a pure function over a plain candidate shape rather than a hook, so the write hook, an
 * import pipeline and a browser form all decide the same way from the same inputs and cannot
 * disagree. It returns every issue rather than the first, because a form has to be able to mark
 * all of them.
 */

/** The columns the arm rule reads. Anything that can produce a candidate row can supply these. */
type ComponentEntryCandidate = Readonly<{
	readonly event: unknown;
	readonly amount?: unknown;
	readonly pay_period?: unknown;
	readonly effective_range?: unknown;
	readonly corrects_adjustment_id?: unknown;
	readonly evidence_file?: unknown;
}>;

/**
 * The refusal raised when an entry's payload does not match the event it declares.
 *
 * **This exact string is the name.** Hooks raise it, the test asserts on it, and an operator reads
 * it at the head of the sentence. Renaming it in one place and not the others unhooks the only
 * guard the arm rule has.
 */
export const COMPONENT_ENTRY_EVENT_MISMATCH = 'COMPONENT_ENTRY_EVENT_MISMATCH' as const;

const PAY_PERIOD = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The two facts a candidate carries beside the event, so "allowed" can be subtracted. */
const BESIDE_EVENT = ['effective_range', 'corrects_adjustment_id', 'evidence_file'] as const;

/** Whether an optional column is actually stated: null-ish, empty array and blank text are not. */
const present = (value: unknown): boolean => {
	if (value == null) return false;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === 'string') return value.trim().length > 0;
	return true;
};

const decodeEvent = (event: unknown) =>
	Schema.decodeUnknownResult(componentEntryEventSchema)(event);

/**
 * Every way this candidate disagrees with the event it declares, as sentences. Empty means the
 * candidate is consistent.
 */
export const componentEntryEventIssues = (candidate: ComponentEntryCandidate): string[] => {
	const issues: string[] = [];
	const parsed = decodeEvent(candidate.event);
	if (Result.isFailure(parsed)) {
		return ['The event is not one of CLAIM, ALLOWANCE, BONUS, ARREARS or MANUAL_ADJUSTMENT.'];
	}
	const event = parsed.success;

	// The event union owns the arm payload and nothing else: a column one arm does not use may not
	// be set on it, and the two columns two arms require are required there.
	const permits = (column: (typeof BESIDE_EVENT)[number]): boolean => {
		switch (column) {
			case 'effective_range':
				return event.kind === 'ALLOWANCE';
			case 'corrects_adjustment_id':
				return event.kind === 'MANUAL_ADJUSTMENT';
			case 'evidence_file':
				return event.kind === 'CLAIM';
		}
	};
	for (const column of BESIDE_EVENT) {
		if (permits(column) || !present(candidate[column])) continue;
		issues.push(
			column === 'effective_range'
				? 'Only a standing allowance states the range it is effective across.'
				: column === 'corrects_adjustment_id'
					? 'Only a manual correction points at the settled output it corrects.'
					: 'Only a claim carries an evidence file.'
		);
	}

	switch (event.kind) {
		case 'CLAIM':
			if (!CALENDAR_DAY.test(event.incurred_on))
				issues.push('A claim must say the day it was incurred.');
			break;
		case 'ALLOWANCE':
			if (!present(candidate.effective_range))
				issues.push('A standing allowance must state the range it is effective across.');
			break;
		case 'BONUS':
			break;
		case 'ARREARS': {
			if (event.covers_periods.length === 0)
				issues.push('Arrears must name at least one period they cover.');
			const malformed = event.covers_periods.filter((period) => !PAY_PERIOD.test(period));
			if (malformed.length > 0)
				issues.push(
					`These covered periods are not months written YYYY-MM: ${malformed.join(', ')}.`
				);
			break;
		}
		case 'MANUAL_ADJUSTMENT':
			break;
	}

	if (!present(candidate.corrects_adjustment_id) && event.kind === 'MANUAL_ADJUSTMENT')
		issues.push('A manual correction must name the settled adjustment it corrects.');

	if (candidate.pay_period != null && candidate.pay_period !== '') {
		if (typeof candidate.pay_period !== 'string' || !PAY_PERIOD.test(candidate.pay_period))
			issues.push('The pay period override must be a month written YYYY-MM.');
	}

	const amount = Number(candidate.amount);
	if (!Number.isFinite(amount) || amount <= 0)
		issues.push('An entry amount is a positive magnitude; direction comes from the pay component.');

	return issues;
};

/**
 * The sentence the refusal carries. Every issue, not the first: a form marks all of them at once,
 * and a person correcting an import row should not have to resubmit four times to be told four
 * things.
 */
export const componentEntryEventMismatchMessage = (
	candidate: ComponentEntryCandidate,
	issues: ReadonlyArray<string> = componentEntryEventIssues(candidate)
): string => `${COMPONENT_ENTRY_EVENT_MISMATCH}: ${issues.join(' ')}`;
