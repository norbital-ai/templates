import { customField } from '@norbital-ai/bolt';
import { programFor } from '../../../lib/expressions/evaluate.js';
import { compileEligibility } from '../../../lib/payroll/run/eligibility.js';
import { getErrorMessage } from '../../../lib/refuse.js';

const f = customField({
	description:
		'When a mandatory payment falls due without anyone asking for it: the legal due days as an expression over the person, the year and their holidays, who is owed it, how early it is raised, and the duty each occurrence records in the obligation ledger.',
	shape: {
		kind: 'object',
		fields: {
			/**
			 * The `YYYY-MM-DD` due day, or a list of them, over the person context plus `year` (int),
			 * `holidays` (the person's published days of `year`: `date`, `name`, `kind`, `religions`) and,
			 * on a leave row, `leave_year.start` / `leave_year.end`.
			 */
			due: { kind: 'text' },
			/** How many days before a due day the entry is raised; 0 raises it on the day. */
			raise_days_before: { kind: 'int', min: 0, optional: true },
			/** A person-site boolean on the due day: who is owed it. Empty is everyone in service. */
			population: { kind: 'text', optional: true },
			/** The version's duty type (subject EMPLOYMENT, trigger SCHEDULED) each occurrence raises. */
			duty: { kind: 'text' }
		}
	}
});
export default f;

f.validate((value) => {
	if (value.due.trim() === '') return 'A schedule states its due day as an expression.';
	if (value.duty.trim() === '') return 'A schedule names the duty type its occurrences raise.';
	try {
		programFor(value.due);
	} catch (error) {
		return `Schedule due: ${getErrorMessage(error)}`;
	}
	const fault = compileEligibility(value.population);
	return fault == null ? undefined : `Schedule population: ${fault}`;
});
