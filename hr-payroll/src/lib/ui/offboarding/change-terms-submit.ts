import { refuse } from '@norbital-ai/bolt/authoring';
import { dateKey } from '../../iso-day.js';
import { shiftDayKey } from '../calendar.js';
import type { ContractAllowance } from '../../../datatypes/contract_allowances/+definition.js';

/** The day before: a successor starting `start` closes its predecessor on this day. */
export function previousDay(start: string): string {
	return shiftDayKey(start, -1);
}

export type ChangeTermsFacts = {
	readonly residency_status: string | null;
	readonly residency_since: string | null;
	readonly base_salary: { readonly value: number; readonly currency: string };
	readonly allowances: readonly ContractAllowance[];
	readonly pay_frequency: string;
	readonly work_classification: string;
	readonly statutory_work_category: string;
	readonly employment_type: string;
	readonly department: string | null;
	readonly job_title: string | null;
	readonly payroll_group: string | null;
	readonly grade: string | null;
	readonly ordinary_hours_per_week: number | null;
	readonly shift_pattern_id: string;
	readonly pass_type: string | null;
	readonly tax_residency: string | null;
	readonly notice_days: number | null;
	readonly paid_rest_days: boolean;
};

/**
 * The contract-change pair: the row in force closes the day before the successor starts. The
 * close is written first; the transform's amendment rule refuses it when it would uncover
 * consumed dates, and the model's exclusion refuses any overlap. No second closing mechanism
 * lives here.
 */
export function buildChangeTermsWrites(options: {
	readonly previousId: string;
	readonly employmentId: string;
	/** Stored range start of the row in force, carried through verbatim. */
	readonly previousStart: string;
	/** The predecessor's new end: the day before the successor starts, as stored. */
	readonly closeEnd: string;
	/** The successor's start, as stored. */
	readonly newStart: string;
	readonly facts: ChangeTermsFacts;
}): {
	readonly close: { readonly id: string; readonly effective_range: { start: string; end: string } };
	readonly create: ChangeTermsFacts & {
		readonly employment_id: string;
		readonly effective_range: { start: string; end: null };
	};
} {
	const { previousId, employmentId, previousStart, closeEnd, newStart, facts } = options;
	if (dateKey(newStart) <= dateKey(previousStart))
		refuse('New terms must start after the terms in force began.');
	if (previousDay(dateKey(newStart)) !== dateKey(closeEnd))
		refuse('New terms start the day after the previous terms close.');
	return {
		close: { id: previousId, effective_range: { start: previousStart, end: closeEnd } },
		create: {
			...facts,
			employment_id: employmentId,
			effective_range: { start: newStart, end: null }
		}
	};
}
