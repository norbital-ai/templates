import { Result, Schema } from 'effect';
import { componentEntryEventSchema } from '../datatypes/component_entry_event/+definition.js';
import { decodeNumber } from '@norbital-ai/std/json';

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

/** The arms an entry may declare, which is exactly the catalogue's `entry_kind` enum. */
export const COMPONENT_ENTRY_KINDS = [
	'CLAIM',
	'ALLOWANCE',
	'BONUS',
	'ARREARS',
	'MANUAL_ADJUSTMENT'
] as const;
export type ComponentEntryKind = (typeof COMPONENT_ENTRY_KINDS)[number];

/**
 * The entry's arm must be the one its component declares.
 *
 * The catalogue states the shape once (`component_catalogue.entry_kind`); the entry restates it in
 * `event.kind`, because the union is what carries the arm's payload and a discriminated union
 * cannot read another table. This is the rule that keeps the two honest, and it is the whole reason
 * `entry_kind` is worth having: without it the arm is a free field, and a free field with one arm
 * requiring nothing (`BONUS`) becomes the value everything defaults to — which is how a tax
 * deduction came to be recorded as a bonus 84 times.
 *
 * A component with no `entry_kind` takes no entries at all: its `definition.source` is the engine,
 * not a person. Both directions are refused, because the silent half — an entry against a
 * schedule-fed component — is the one nothing else would catch.
 */
export const componentEntryKindIssues = (
	declared: unknown,
	componentEntryKind: string | null | undefined,
	componentCode?: string
): string[] => {
	const named = componentCode == null || componentCode === '' ? 'this component' : componentCode;
	if (componentEntryKind == null || componentEntryKind === '')
		return [
			`${named} is calculated by the engine and takes no entries, so it cannot be the component of one.`
		];
	if (typeof declared !== 'string' || declared === '') return [];
	if (declared !== componentEntryKind)
		return [
			`${named} takes ${componentEntryKind} entries, and this one declares ${declared}. The entry shape is the component's, not the entry's.`
		];
	return [];
};

const PAY_PERIOD = /^\d{4}-(?:0[1-9]|1[0-2])$/;
/** A run period: a month, or a half of one at a semi-monthly company (`YYYY-MM-1` / `YYYY-MM-2`). */
const RUN_PERIOD = /^\d{4}-(?:0[1-9]|1[0-2])(?:-[12])?$/;
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The two facts a candidate carries beside the event, so "allowed" can be subtracted. */
const BESIDE_EVENT = ['corrects_adjustment_id', 'evidence_file'] as const;

/** Whether an optional column is actually stated: null-ish, empty array and blank text are not. */
const present = (value: unknown): boolean => {
	if (value == null) return false;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === 'string') return value.trim().length > 0;
	return true;
};

/**
 * Every way this candidate disagrees with the event it declares, as sentences. Empty means the
 * candidate is consistent.
 */
export const componentEntryEventIssues = (candidate: ComponentEntryCandidate): string[] => {
	const issues: string[] = [];
	const parsed = Schema.decodeUnknownResult(componentEntryEventSchema)(candidate.event);
	if (Result.isFailure(parsed)) {
		return ['The event is not one of CLAIM, ALLOWANCE, BONUS, ARREARS or MANUAL_ADJUSTMENT.'];
	}
	const event = parsed.success;

	// The event union owns the arm payload and nothing else: a column one arm does not use may not
	// be set on it, and the two columns two arms require are required there.
	const permits = (column: (typeof BESIDE_EVENT)[number]): boolean => {
		switch (column) {
			case 'corrects_adjustment_id':
				return event.kind === 'MANUAL_ADJUSTMENT';
			case 'evidence_file':
				return event.kind === 'CLAIM';
		}
	};
	for (const column of BESIDE_EVENT) {
		if (permits(column) || !present(candidate[column])) continue;
		issues.push(
			column === 'corrects_adjustment_id'
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
			// Nothing to check: the arm's own `recurrence` union carries the window, so an allowance
			// without one does not decode. Two refusals died here — a range on the wrong arm, and an
			// allowance with none — because the type made both unsayable.
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
		if (typeof candidate.pay_period !== 'string' || !RUN_PERIOD.test(candidate.pay_period))
			issues.push(
				'The pay period override must be a payroll period: a month written YYYY-MM, or a half ' +
					'written YYYY-MM-1 / YYYY-MM-2 at a semi-monthly company.'
			);
	}

	const amount = decodeNumber(candidate.amount);
	if (!Number.isFinite(amount) || amount <= 0)
		issues.push('An entry amount is a positive magnitude; direction comes from the component.');

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
