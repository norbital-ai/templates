import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

/**
 * How one run's statutory charges were derived: one entry per payslip, one
 * scheme entry per charge, each naming the priced lines that fed its base, the producers it read,
 * the rule that governed and the two shares it wrote.
 *
 * This is the run's audit trail, not a second calculation: every figure is copied from the charge
 * the engine already wrote, so a reader can trace base → rule → charge without re-deriving it.
 */

const traceInputSchema = Schema.Struct({
	/** The catalogue component or work class the line settles under, e.g. `OVERTIME`. */
	code: Schema.String,
	/** The band label that priced it, e.g. the OT class `1.5`. */
	label: Schema.String,
	effect: Schema.Literals(['INCLUDE', 'REDUCE']),
	amount: Schema.Finite
});

const traceReadSchema = Schema.Struct({
	/** The producer named by a `produced.<code>` read. */
	code: Schema.String,
	/** The relievable employee amount the read supplied. */
	employee_amount: Schema.Finite,
	/** The normal-pay relief when it differs from the full additional-pay calculation. */
	ordinary_employee_amount: Schema.optional(Schema.Finite),
	employer_amount: Schema.Finite
});

const traceSchemeSchema = Schema.Struct({
	scheme_code: Schema.String,
	/** The governing rule's `when`, or null where the scheme charged at zero. */
	rule_when: Schema.NullOr(Schema.String),
	/** Liability history used by the selected rule, preserved independently of later declarations. */
	first_contribution_due_on: Schema.optional(Schema.String),
	base_amount: Schema.Finite,
	ordinary_amount: Schema.optional(Schema.Finite),
	/** The cadence the assessment was calculated at; period keys alone cannot state it. */
	assessment_frequency: Schema.optionalKey(Schema.Literals(['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY'])),
	employee_amount: Schema.Finite,
	employer_amount: Schema.Finite,
	/** The priced lines whose signed sum is the base, in the order the engine accumulated them. */
	inputs: Schema.Array(traceInputSchema),
	/** The `produced.<code>` reads this charge made, in first-mention order. */
	reads: Schema.Array(traceReadSchema)
});

/**
 * One band slice of a day whose overtime the worker took as time off (`work_days.time_off_in_lieu`):
 * credited on the payslip that settled the day (`paid` false) at what the band would have paid,
 * or paid out (`paid` true) when it went untaken past its expiry or the contract's end. A later
 * run reads both to keep the balance (TW 勞基法 §32-1).
 */
const traceInLieuSchema = Schema.Struct({
	work_day_id: Schema.String,
	date: Schema.String,
	line: Schema.String,
	label: Schema.String,
	hours: Schema.Finite,
	rate: Schema.Finite,
	amount: Schema.Finite,
	paid: Schema.Boolean
});
export type InLieuSlice = Schema.Schema.Type<typeof traceInLieuSchema>;

const tracePayslipSchema = Schema.Struct({
	employment_id: Schema.String,
	employee_number: Schema.String,
	schemes: Schema.Array(traceSchemeSchema),
	/**
	 * The overtime this payslip settled, by calendar month, as each month, quarter and year limit
	 * counts it (`limit` its key; `''` the regulated count the monthly funnel reads). A later run's
	 * quarter or year reads it: the lines alone cannot say which hours a limit counted.
	 */
	overtime_hours: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({ limit: Schema.String, month: Schema.String, hours: Schema.Finite })
		)
	),
	time_off_in_lieu: Schema.optionalKey(Schema.Array(traceInLieuSchema)),
	/**
	 * The attendance window's days with overtime or night-window hours (`person.period.overtime_days`),
	 * and the region's monthly floor in force over the window (`minimum_wage(region)`), so a later
	 * run bounds each earlier payslip's per-day de minimis ceiling at the floor of its own time
	 * (`earned_daily_excess`).
	 */
	overtime_days: Schema.optionalKey(Schema.Finite),
	minimum_wage: Schema.optionalKey(Schema.Finite)
});

export const payrollTraceValueSchema = Schema.Array(tracePayslipSchema);
export type PayrollTrace = Schema.Schema.Type<typeof payrollTraceValueSchema>;

export default defineCustomType({
	name: 'payroll_trace',
	description:
		'The calculation flow behind one payroll run: per payslip, each charged scheme with the lines that fed its base, the producer reads it made, the governing rule and the two shares written.',
	schema: Schema.toStandardSchemaV1(payrollTraceValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
