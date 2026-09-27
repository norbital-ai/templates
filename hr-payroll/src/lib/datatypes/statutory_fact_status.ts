import { isCalendarDate } from '../iso-day.js';

type Frequency = 'MONTHLY' | 'SEMI_MONTHLY' | 'WEEKLY';

/** A directed instalment (MY Form CP38): withheld each month `from`–`to` (`YYYY-MM`), after the ladder. */
export type StatutoryFactInstalment = {
	readonly amount: number;
	readonly from: string;
	readonly to: string;
	readonly reference: string;
};

/** Employer-accepted deductions, including prior-employer declarations and signed corrections. */
export type StatutoryDeductionClaim = {
	readonly period: string;
	readonly category: string;
	readonly amount: number;
	readonly source: 'EMPLOYEE' | 'PRIOR_EMPLOYER';
	readonly reference: string;
	/** Stable event identity across the original claim and separately referenced corrections. */
	readonly event_reference?: string | null;
};

/**
 * A person's dated registration and declarations for a statutory contribution. `rate_override`
 * replaces a percentage award (voluntary EPF) or a progressive scheme with a flat one (non-resident
 * PCB). `since` is current-employer registration; `first_contribution_due_on` includes prior employers.
 */
export type StatutoryFactStatus =
	| {
			readonly kind: 'REGISTERED';
			readonly reference_number: string;
			readonly rate_override?: number | null;
			readonly since?: string | null;
			readonly first_contribution_due_on?: string | null;
			readonly instalments?: readonly StatutoryFactInstalment[] | null;
			/** The employment's elections under this scheme; keys the scheme row declares. */
			readonly elections?: { readonly [key: string]: boolean | number | string } | null;
			/**
			 * Imported annual figures: prior-employer declarations (MY Form TP3, PH BIR 2316) or
			 * current/Board-approved related-employer CPF history. The scheme selects the origin scope.
			 */
			readonly opening?:
				| readonly {
						readonly year: string;
						readonly base: number;
						readonly employee: number;
						readonly employer: number;
						/** Earlier-employer rebatable payments, such as TP3 zakat. */
						readonly rebate?: number | null;
						readonly ordinary?: number | null;
						readonly origin?:
							'CURRENT_EMPLOYER' | 'OTHER_EMPLOYER' | 'APPROVED_RELATED_EMPLOYER' | null;
						readonly board_approval_reference?: string | null;
						readonly employers_related?: boolean | null;
						readonly employee_informed?: boolean | null;
						readonly terms_unchanged?: boolean | null;
						readonly transferred_employee?: boolean | null;
						readonly months?: number | null;
						readonly payroll_periods?: number | null;
						readonly payroll_frequency?: Frequency | null;
						readonly reference: string;
				  }[]
				| null;
			/** Tax-year child-relief declarations; family records alone do not establish a claim. */
			readonly child_claims?:
				| readonly {
						readonly year: string;
						readonly relief_class: string;
						readonly full_count: number;
						readonly half_count: number;
						readonly reference: string;
				  }[]
				| null;
			readonly deduction_claims?: readonly StatutoryDeductionClaim[] | null;
			/** Payment facts for a rule that assesses each daily/average-daily unit independently. */
			readonly unit_assessments?:
				| readonly {
						readonly period: string;
						readonly gross: number;
						readonly units: number;
						readonly reference: string;
				  }[]
				| null;
	  }
	| { readonly kind: 'NOT_REGISTERED'; readonly reason: string };

const count = (value: number | null | undefined) =>
	value == null || (Number.isInteger(value) && value >= 0);

export function statutoryFactStatusFault(status: StatutoryFactStatus): string | undefined {
	if (status.kind === 'NOT_REGISTERED')
		return status.reason === '' ? 'reason: is required' : undefined;
	if (status.reference_number === '') return 'reference_number: is required';
	if ((status.rate_override ?? 0) < 0) return 'rate_override: must not be negative';
	if (status.first_contribution_due_on != null && !isCalendarDate(status.first_contribution_due_on))
		return 'first_contribution_due_on: must name a day that exists';
	for (const value of Object.values(status.elections ?? {}))
		if (!['boolean', 'number', 'string'].includes(typeof value))
			return 'elections: a value is a boolean, a number or text';
	for (const opening of status.opening ?? []) {
		if (
			opening.year.length < 4 ||
			opening.base < 0 ||
			opening.employee < 0 ||
			opening.employer < 0 ||
			(opening.ordinary ?? 0) < 0 ||
			(opening.rebate ?? 0) < 0 ||
			!count(opening.months) ||
			!count(opening.payroll_periods)
		)
			return 'opening: a four-digit year and non-negative amounts and counts';
		if (
			opening.origin === 'APPROVED_RELATED_EMPLOYER' &&
			(!opening.board_approval_reference?.trim() ||
				opening.employers_related !== true ||
				opening.employee_informed !== true ||
				opening.terms_unchanged !== true ||
				opening.transferred_employee !== true)
		)
			return 'opening: a related-employer ceiling requires Board approval, a transfer, related employers, employee notice and unchanged terms';
	}
	for (const claim of status.child_claims ?? [])
		if (!count(claim.full_count) || !count(claim.half_count))
			return 'child_claims: counts are whole and non-negative';
	for (const unit of status.unit_assessments ?? [])
		if (
			!/^\d{4}-(0[1-9]|1[0-2])(?:-[1-5])?$/.test(unit.period) ||
			unit.gross < 0 ||
			!Number.isInteger(unit.units) ||
			unit.units <= 0 ||
			!/\S/.test(unit.reference)
		)
			return 'unit_assessments: a period, non-negative gross, whole positive units and a reference';
	return undefined;
}
