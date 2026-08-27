/**
 * ============================================================================
 * THE ARM RULE THE COLUMNS CANNOT STATE
 * ============================================================================
 *
 * `obligations` holds four arms in one table - ONE_OFF, RECURRING, SCHEDULED, REVERSAL - and each
 * arm uses some of the payload columns and not the others. A discriminated union in a jsonb column
 * would have stated that at decode time and for free. It would also have hidden a foreign key and a
 * file inside a blob, put the row predicate that hides HR's corrections behind a JSON path, and left
 * a field grant nothing to mask. See the head of `collections/obligations/+model.ts`.
 *
 * So the columns are real, and the arm rule is HERE, as a named refusal:
 *
 *     A RULE THE DATABASE CANNOT STATE IS A NAMED REFUSAL, NOT A COMMENT.
 *
 * That is the same trade `OBLIGATION_OVER_CONSUMED` makes in `settlement_refusals.ts` for the
 * `SINGLE_USE` invariant, and it is made deliberately in both places. This file is that trade's
 * other half, kept separate because settlement is about what a run *takes* and this is about what an
 * obligation *is*.
 *
 * It is a pure function over a plain row shape rather than a hook, so the write hook, an import
 * pipeline and a browser form all decide the same way from the same inputs and cannot disagree.
 * It returns every issue rather than the first, because a form has to be able to mark all of them.
 */

/** The columns the arm rule reads. Anything that can produce a candidate row can supply these. */
export type ObligationTermsCandidate = Readonly<{
	readonly terms: string;
	readonly occasion?: string | null;
	readonly effective_range?: unknown;
	readonly instalments?: ReadonlyArray<{ readonly due_date: string; readonly amount: number }> | null;
	readonly note?: string | null;
	readonly reason?: string | null;
	readonly incurred_on?: string | null;
	readonly evidence_file?: unknown;
	readonly covers_periods?: ReadonlyArray<string> | null;
	readonly reverses_obligation_id?: string | null;
	readonly amount?: number | null;
}>;

/**
 * The refusal raised when an obligation's payload does not match the arm it declares.
 *
 * **This exact string is the name.** Hooks raise it, the test asserts on it, and an operator reads
 * it at the head of the sentence. Renaming it in one place and not the others unhooks the only
 * guard the arm rule has.
 */
export const OBLIGATION_TERMS_MISMATCH = 'OBLIGATION_TERMS_MISMATCH' as const;

/** At most 600 instalments, the bound the array schema used to carry before the array was inlined. */
const MAX_INSTALMENTS = 600;

const PAY_PERIOD = /^\d{4}-(?:0[1-9]|1[0-2])$/;

const present = (value: unknown): boolean =>
	value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0);

const nonEmptyText = (value: unknown): boolean =>
	typeof value === 'string' && value.trim().length > 0;

/**
 * Which columns each arm is allowed to carry.
 *
 * ONE_OFF allows only `occasion`; the occasion then adds its own payload below. Listing ONE_OFF's
 * payload here instead would have made the per-occasion table decorative — every ONE_OFF column
 * would already be permitted by the time the occasion was consulted, so a claim carrying arrears'
 * covered periods would have passed.
 */
const ALLOWED_BY_TERMS: Readonly<Record<string, ReadonlyArray<keyof ObligationTermsCandidate>>> = {
	ONE_OFF: ['occasion'],
	RECURRING: ['effective_range'],
	SCHEDULED: ['effective_range', 'instalments'],
	REVERSAL: ['reverses_obligation_id', 'reason']
};

const ALLOWED_BY_OCCASION: Readonly<Record<string, ReadonlyArray<keyof ObligationTermsCandidate>>> =
	{
		ENTERED: ['note'],
		CLAIM: ['incurred_on', 'evidence_file'],
		ARREARS: ['covers_periods', 'reason'],
		ADJUSTMENT: ['note']
	};

/** Every payload column, so "allowed" can be subtracted from it rather than restated. */
const PAYLOAD_COLUMNS = [
	'occasion',
	'effective_range',
	'instalments',
	'note',
	'reason',
	'incurred_on',
	'evidence_file',
	'covers_periods',
	'reverses_obligation_id'
] as const;

const LABELS: Readonly<Record<string, string>> = {
	occasion: 'an occasion',
	effective_range: 'an effective range',
	instalments: 'an instalment schedule',
	note: 'a note',
	reason: 'a reason',
	incurred_on: 'an incurred date',
	evidence_file: 'an evidence file',
	covers_periods: 'covered periods',
	reverses_obligation_id: 'a reversed obligation'
};

/**
 * Every way this candidate's payload disagrees with the arm it declares, as sentences.
 *
 * Empty means the row is consistent. The caller raises `OBLIGATION_TERMS_MISMATCH` with
 * `obligationTermsMismatchMessage` when it is not.
 */
export const obligationTermsIssues = (
	candidate: ObligationTermsCandidate
): ReadonlyArray<string> => {
	const issues: string[] = [];
	const allowed = ALLOWED_BY_TERMS[candidate.terms];
	if (allowed === undefined) {
		return [`"${candidate.terms}" is not one of ONE_OFF, RECURRING, SCHEDULED or REVERSAL.`];
	}

	// 1. The arm has to be resolvable before "what may it carry" has an answer at all. A ONE_OFF
	//    whose occasion is missing or unknown gets that one issue and nothing else — listing every
	//    column it "cannot carry" underneath would be noise generated by our own inability to tell.
	const occasionPayload =
		candidate.terms === 'ONE_OFF'
			? typeof candidate.occasion === 'string'
				? ALLOWED_BY_OCCASION[candidate.occasion]
				: undefined
			: [];
	if (occasionPayload === undefined) {
		return [
			typeof candidate.occasion === 'string'
				? `"${candidate.occasion}" is not one of ENTERED, CLAIM, ARREARS or ADJUSTMENT.`
				: 'A ONE_OFF obligation must say what occasion it was raised on.'
		];
	}

	// 2. Nothing the arm does not use may be set. Stated as a subtraction over every payload column
	//    so a column added to the model and forgotten here is refused rather than silently permitted
	//    on every arm — the failure mode a positive list has and this one does not.
	const permitted = new Set<string>([...allowed, ...occasionPayload]);
	const carrier =
		candidate.terms === 'ONE_OFF' ? `A ${candidate.occasion} obligation` : `A ${candidate.terms} obligation`;
	for (const column of PAYLOAD_COLUMNS) {
		if (permitted.has(column) || !present(candidate[column])) continue;
		issues.push(`${carrier} cannot carry ${LABELS[column]}.`);
	}

	// 3. What each arm requires.
	switch (candidate.terms) {
		case 'ONE_OFF': {
			if (candidate.occasion === 'CLAIM' && !nonEmptyText(candidate.incurred_on)) {
				issues.push('A claim must say the day it was incurred.');
			}
			if (candidate.occasion === 'ARREARS') {
				const periods = candidate.covers_periods ?? [];
				if (periods.length === 0) issues.push('Arrears must name at least one period they cover.');
				const malformed = periods.filter((period) => !PAY_PERIOD.test(period));
				if (malformed.length > 0) {
					issues.push(`These covered periods are not months written YYYY-MM: ${malformed.join(', ')}.`);
				}
				if (!nonEmptyText(candidate.reason)) issues.push('Arrears must state a reason.');
			}
			if (candidate.occasion === 'ADJUSTMENT' && !nonEmptyText(candidate.note)) {
				issues.push('An adjustment must state what it corrects.');
			}
			break;
		}
		case 'RECURRING': {
			if (!present(candidate.effective_range)) {
				issues.push('A recurring obligation must state the range it is effective across.');
			}
			break;
		}
		case 'SCHEDULED': {
			if (!present(candidate.effective_range)) {
				issues.push('A scheduled obligation must state the range it is effective across.');
			}
			const instalments = candidate.instalments ?? [];
			if (instalments.length === 0) {
				issues.push('A scheduled obligation must carry at least one instalment.');
			}
			if (instalments.length > MAX_INSTALMENTS) {
				issues.push(`A schedule cannot hold more than ${MAX_INSTALMENTS} instalments.`);
			}
			break;
		}
		case 'REVERSAL': {
			if (!nonEmptyText(candidate.reverses_obligation_id)) {
				issues.push('A reversal must name the obligation it reverses.');
			}
			if (!nonEmptyText(candidate.reason)) issues.push('A reversal must state a reason.');
			break;
		}
	}
	return issues;
};

/**
 * The sentence the refusal carries.
 *
 * Every issue, not the first: a form marks all of them at once, and a person correcting an import
 * row should not have to resubmit four times to be told four things.
 */
export const obligationTermsMismatchMessage = (
	candidate: ObligationTermsCandidate,
	issues: ReadonlyArray<string> = obligationTermsIssues(candidate)
): string => `${OBLIGATION_TERMS_MISMATCH}: ${issues.join(' ')}`;
