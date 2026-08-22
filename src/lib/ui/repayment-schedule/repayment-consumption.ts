import { Schema } from 'effect';

/**
 * What a repayment schedule row can honestly say about itself.
 *
 * Consumption is not a flag. An instalment is recovered when payroll persisted a payslip line to
 * the component entry the agreement materialised for it — so the only thing this file can observe
 * directly is "a line exists" or "no line exists".
 *
 * "No line exists" was previously rendered as a bare **"Not consumed"**, which is four different
 * situations wearing one label:
 *
 * | situation                                    | what an operator should do            |
 * | -------------------------------------------- | ------------------------------------- |
 * | the due period is still in the future         | nothing                               |
 * | the due period has no payroll run yet         | nothing — the run will take it        |
 * | the due period's run is still a draft         | recalculate that draft                |
 * | the due period's run is **paid**              | act: that money was never recovered   |
 *
 * The last one is the only defect, and it is unrecoverable by the run itself: a paid run is
 * immutable (`payroll_runs/+hooks.ts` refuses to rebuild one), so an instalment that was not
 * present when its period was built can never be picked up by that period again. Presenting it
 * identically to the three benign cases is what makes a closed period indistinguishable from a
 * broken engine.
 */

const repaymentConsumptionReferenceSchema = Schema.Struct({
	payslipLineId: Schema.String,
	payslipId: Schema.String,
	payrollRunId: Schema.String,
	payslipLineSequence: Schema.Number,
	payrollPeriod: Schema.String,
	cycleDate: Schema.String,
	consumedAt: Schema.String,
	/**
	 * What payroll actually deducted, when the line records it. Lower than the scheduled amount when
	 * the negative-net guard reduced the deduction; the remainder is carried forward as an arrears
	 * entry by `payroll_runs/lib/persist.ts`, so the instalment is still settled — but the schedule
	 * should say the run only took part of it rather than implying the full figure left the payslip.
	 */
	recoveredAmount: Schema.NullOr(Schema.Number)
});
type RepaymentConsumptionReference = Schema.Schema.Type<typeof repaymentConsumptionReferenceSchema>;

export const repaymentConsumptionCellSchema = Schema.Union([
	Schema.Struct({ status: Schema.Literal('loading') }),
	Schema.Struct({ status: Schema.Literal('error'), message: Schema.String }),
	Schema.Struct({
		status: Schema.Literal('consumed'),
		reference: repaymentConsumptionReferenceSchema
	}),
	/** The due period is in the future and no run has reached it. */
	Schema.Struct({ status: Schema.Literal('not_due'), period: Schema.String }),
	/** The due period is here or past, but no payroll run exists for it yet. */
	Schema.Struct({ status: Schema.Literal('awaiting_run'), period: Schema.String }),
	/** A run exists for the due period and is still a draft — recalculating it takes the instalment. */
	Schema.Struct({ status: Schema.Literal('awaiting_rebuild'), period: Schema.String }),
	/** The due period's run is paid and did not deduct this instalment. Nothing will now. */
	Schema.Struct({ status: Schema.Literal('unrecovered'), period: Schema.String })
]);
export type RepaymentConsumptionCell = Schema.Schema.Type<typeof repaymentConsumptionCellSchema>;

const repaymentScheduleMatrixRowSchema = Schema.Struct({
	id: Schema.String,
	due_date: Schema.String,
	amount: Schema.Number,
	consumed_by: repaymentConsumptionCellSchema,
	consumed_at: Schema.NullOr(Schema.String)
});
export type RepaymentScheduleMatrixRow = Schema.Schema.Type<
	typeof repaymentScheduleMatrixRowSchema
>;

const repaymentConsumptionSourceRowSchema = Schema.Struct({
	repayment_sequence: Schema.optional(Schema.NullOr(Schema.Number)),
	entry_payslip_lines: Schema.optional(
		Schema.NullOr(
			Schema.Array(
				Schema.Struct({
					created_at: Schema.optional(Schema.NullOr(Schema.String)),
					id: Schema.optional(Schema.NullOr(Schema.String)),
					sequence: Schema.optional(Schema.NullOr(Schema.Number)),
					amount: Schema.optional(Schema.Unknown),
					payslip_line_payslip: Schema.optional(
						Schema.NullOr(
							Schema.Struct({
								id: Schema.optional(Schema.NullOr(Schema.String)),
								payslip_payroll_run: Schema.optional(
									Schema.NullOr(
										Schema.Struct({
											id: Schema.optional(Schema.NullOr(Schema.String)),
											period: Schema.optional(Schema.NullOr(Schema.String)),
											pay_date: Schema.optional(Schema.NullOr(Schema.String))
										})
									)
								)
							})
						)
					)
				})
			)
		)
	)
});
export type RepaymentConsumptionSourceRow = Schema.Schema.Type<
	typeof repaymentConsumptionSourceRowSchema
>;

/** A payroll run as this screen needs to read it: which period, and how settled it is. */
const repaymentPeriodRunRowSchema = Schema.Struct({
	period: Schema.optional(Schema.NullOr(Schema.String)),
	lifecycle: Schema.optional(Schema.NullOr(Schema.String))
});
type RepaymentPeriodRunRow = Schema.Schema.Type<typeof repaymentPeriodRunRowSchema>;

/** The inputs of `resolveRepaymentConsumption`, as one shape. */
const resolveRepaymentConsumptionOptionsSchema = Schema.Struct({
	dueDate: Schema.String,
	reference: Schema.optional(repaymentConsumptionReferenceSchema),
	runLifecycleByPeriod: Schema.ReadonlyMap(Schema.String, Schema.NullOr(Schema.String)),
	/** `YYYY-MM-DD`. */
	today: Schema.String
});
type ResolveRepaymentConsumptionOptions = Schema.Schema.Type<
	typeof resolveRepaymentConsumptionOptionsSchema
>;

function nonEmpty(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function numeric(value: unknown): number | null {
	if (value == null || value === '') return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The run an instalment settles in.
 *
 * UI status for an unconsumed row uses the calendar month of the due date. MEASURE itself
 * assigns the instalment with `defaultPayPeriod(due_date, cutoffDay)`; first-of-month due dates
 * (the seeded loans) name the same period either way.
 */
export function instalmentPayPeriod(dueDate: string): string {
	return String(dueDate).slice(0, 7);
}

/** `period` → `lifecycle`, for the company that owns the agreement's employment. */
export function repaymentRunLifecycleByPeriod(
	runs: readonly RepaymentPeriodRunRow[]
): ReadonlyMap<string, string | null> {
	const byPeriod = new Map<string, string | null>();
	for (const run of runs) {
		const period = nonEmpty(run.period);
		if (period == null) continue;
		byPeriod.set(period, nonEmpty(run.lifecycle));
	}
	return byPeriod;
}

/**
 * Index the single nested provenance query by the canonical schedule sequence.
 *
 * A schedule row is consumed only when a persisted payslip line for that agreement sequence
 * reaches an exact payslip and payroll run. Partial links are not presented as a completed recovery.
 */
export function repaymentConsumptionBySequence(
	rows: readonly RepaymentConsumptionSourceRow[]
): ReadonlyMap<number, RepaymentConsumptionReference> {
	const references = new Map<number, RepaymentConsumptionReference>();
	for (const row of rows) {
		const sequence = row.repayment_sequence;
		if (typeof sequence !== 'number' || references.has(sequence)) continue;
		for (const source of row.entry_payslip_lines ?? []) {
			const line = source;
			const payslip = line?.payslip_line_payslip;
			const run = payslip?.payslip_payroll_run;
			const payslipLineId = nonEmpty(line?.id);
			const payslipId = nonEmpty(payslip?.id);
			const payrollRunId = nonEmpty(run?.id);
			const payrollPeriod = nonEmpty(run?.period);
			const cycleDate = nonEmpty(run?.pay_date);
			const consumedAt = nonEmpty(source.created_at);
			if (
				payslipLineId == null ||
				payslipId == null ||
				payrollRunId == null ||
				payrollPeriod == null ||
				cycleDate == null ||
				consumedAt == null ||
				typeof line?.sequence !== 'number'
			) {
				continue;
			}
			references.set(sequence, {
				payslipLineId,
				payslipId,
				payrollRunId,
				payslipLineSequence: line.sequence,
				payrollPeriod,
				cycleDate,
				consumedAt,
				recoveredAmount: numeric(line.amount)
			});
			break;
		}
	}
	return references;
}

/**
 * Why a schedule row is where it is.
 *
 * Deliberately ordered: an existing payslip line is the strongest evidence there is and wins over
 * everything, and beyond that the run's own lifecycle outranks the calendar — a paid period is a
 * closed period whether or not the due date has passed.
 */
export function resolveRepaymentConsumption(
	options: ResolveRepaymentConsumptionOptions
): RepaymentConsumptionCell {
	if (options.reference != null) return { status: 'consumed', reference: options.reference };
	const period = instalmentPayPeriod(options.dueDate);
	const lifecycle = options.runLifecycleByPeriod.get(period);
	if (lifecycle === 'PAID') return { status: 'unrecovered', period };
	if (lifecycle != null) return { status: 'awaiting_rebuild', period };
	if (String(options.dueDate).slice(0, 10) > options.today) return { status: 'not_due', period };
	return { status: 'awaiting_run', period };
}

/** What the run recovered, against what the schedule asked for. */
export function repaymentShortfall(
	scheduledAmount: number,
	reference: RepaymentConsumptionReference
): number | null {
	const recovered = reference.recoveredAmount;
	if (recovered == null) return null;
	const short = Math.round((Number(scheduledAmount) - recovered) * 100) / 100;
	return short > 0 ? short : null;
}

export function formatPayrollCycleDate(value: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
	return match ? `${match[3]}-${match[2]}-${match[1].slice(-2)}` : value;
}
