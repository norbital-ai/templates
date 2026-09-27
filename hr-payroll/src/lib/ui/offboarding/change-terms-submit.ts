import type { Id, Insert } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
import { refuse } from '../../refuse.js';
import { dateKey } from '../../iso-day.js';
import { addDays } from '../../../lib/payroll/run/dates.js';

/** The day before: a successor starting `start` closes its predecessor on this day. */
export function previousDay(start: string): string {
	return addDays(start, -1);
}

/** A successor's facts: every column of the terms but the contract and the period, which the pair states. */
export type ChangeTermsFacts = Omit<
	Insert<'employment_terms'>,
	'employment_id' | 'effective_range'
>;

/**
 * The contract-change pair: the row in force closes the day before the successor starts. The
 * close is written first; the transform's amendment rule refuses it when it would uncover
 * consumed dates, and the model's exclusion refuses any overlap. No second closing mechanism
 * lives here.
 */
export function buildChangeTermsWrites(options: {
	readonly previousId: Id<'employment_terms'>;
	readonly employmentId: Id<'employments'>;
	/** Stored range start of the row in force, carried through verbatim. */
	readonly previousStart: string;
	/** The predecessor's new end: the day before the successor starts, as stored. */
	readonly closeEnd: string;
	/** The successor's start, as stored. */
	readonly newStart: string;
	readonly facts: ChangeTermsFacts;
}): {
	/** The update that closes the row in force: `ctx.act('employment_terms.update', close)`. */
	readonly close: {
		readonly target: Id<'employment_terms'>;
		readonly set: { readonly effective_range: { from: PlainDate; to: PlainDate } };
	};
	readonly create: ChangeTermsFacts & {
		readonly employment_id: Id<'employments'>;
		readonly effective_range: { from: PlainDate; to: null };
	};
} {
	const { previousId, employmentId, previousStart, closeEnd, newStart, facts } = options;
	if (dateKey(newStart) <= dateKey(previousStart))
		refuse('New terms must start after the terms in force began.');
	if (previousDay(dateKey(newStart)) !== dateKey(closeEnd))
		refuse('New terms start the day after the previous terms close.');
	return {
		close: {
			target: previousId,
			set: { effective_range: { from: PlainDate(previousStart), to: PlainDate(closeEnd) } }
		},
		create: {
			...facts,
			employment_id: employmentId,
			effective_range: { from: PlainDate(newStart), to: null }
		}
	};
}
