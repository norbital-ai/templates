import { Schema } from 'effect';

/**
 * The declared boundary of a catalog row's program: the only context roots it may read, the shape of its own params and
 * the type each expression returns. A family absent here keeps the full calculation roots until it is migrated.
 */
export type Program = {
	readonly roots: readonly string[];
	readonly outputs: Readonly<Record<string, Schema.ConstraintDecoder<unknown>>>;
};

const number = Schema.Number;
const boolean = Schema.Boolean;

export const PROGRAMS: Readonly<Record<string, Program>> = {
	overtime_catalog: {
		roots: [
			'work_events',
			'entry',
			'subject',
			'lookup',
			'base_pay',
			'subtotals',
			'calendar_days',
			'working_days',
			'month_wage',
			'day_rate',
			'hour_rate',
			'work',
			'run',
			'as_of'
		],
		outputs: { eligibility: boolean, conversion: number }
	},
	allowance_catalog: {
		roots: [
			'work_events',
			'subject',
			'lookup',
			'subtotals',
			'calendar_days',
			'working_days',
			'month_wage',
			'day_rate',
			'hour_rate',
			'run',
			'as_of'
		],
		outputs: { eligibility: boolean, conversion: number }
	},
	statutory_contribution_catalog: {
		roots: [
			'work_events',
			'subject',
			'lookup',
			'base_pay',
			'subtotals',
			'calendar_days',
			'working_days',
			'month_wage',
			'day_rate',
			'hour_rate',
			'balances',
			'statutory',
			'allowance',
			'overtime',
			'work',
			'run',
			'as_of'
		],
		outputs: { eligibility: boolean, employee_amount: number, employer_amount: number }
	},
	leave_catalog: {
		roots: [
			'work_events',
			'entry',
			'subject',
			'lookup',
			'base_pay',
			'calendar_days',
			'working_days',
			'month_wage',
			'day_rate',
			'hour_rate',
			'work',
			'run',
			'as_of'
		],
		outputs: { eligibility: boolean, conversion: number }
	},
	claim_catalog: {
		roots: [
			'work_events',
			'entry',
			'subject',
			'lookup',
			'month_wage',
			'day_rate',
			'hour_rate',
			'run'
		],
		outputs: { eligibility: boolean, conversion: number }
	},
	adhoc_catalog: {
		roots: [
			'work_events',
			'entry',
			'subject',
			'lookup',
			'base_pay',
			'subtotals',
			'calendar_days',
			'working_days',
			'month_wage',
			'day_rate',
			'hour_rate',
			'balances',
			'run',
			'as_of'
		],
		outputs: { eligibility: boolean, conversion: number }
	},
	loan_catalog: {
		roots: ['work_events', 'entry', 'subject', 'lookup'],
		outputs: { eligibility: boolean, conversion: number }
	}
};

export const programOf = (model: string): Program | undefined => PROGRAMS[model];
