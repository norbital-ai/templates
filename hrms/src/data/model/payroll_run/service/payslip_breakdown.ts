import { Schema } from 'effect';
import type { PayrollResult } from './engine.js';

export const PayslipBreakdown = Schema.Struct({
	checkpoints: Schema.Array(
		Schema.Struct({
			code: Schema.String,
			name: Schema.String,
			value: Schema.Number
		})
	),
	lines: Schema.Array(
		Schema.Struct({
			code: Schema.String,
			label: Schema.String,
			/** The code of the subtotal the line posts to. */
			subtotal: Schema.String,
			amount: Schema.Number,
			direction: Schema.String,
			party: Schema.String,
			source: Schema.String,
			quantity: Schema.optional(Schema.Number),
			unit: Schema.optional(Schema.String),
			/** The earlier pay period this line belongs to: a difference this payslip carries for it. */
			period: Schema.optional(Schema.String)
		})
	),
	statutory: Schema.Array(
		Schema.Struct({
			code: Schema.String,
			kind: Schema.String,
			employee: Schema.Number,
			employer: Schema.Number
		})
	),
	/** What the payslip carries for earlier pay periods, beside its tagged lines: where each difference posts. */
	carried: Schema.optional(
		Schema.Array(
			Schema.Struct({
				run_id: Schema.String,
				period: Schema.String,
				postings: Schema.Array(
					Schema.Struct({
						account: Schema.String,
						code: Schema.String,
						period: Schema.String,
						measure: Schema.String,
						amount: Schema.Number,
						unit: Schema.optional(Schema.String),
						effective_on: Schema.String
					})
				)
			})
		)
	),
	/** Overtime taken as time off, which the payslip posts as hours owed; a payslip with none carries none. */
	time_off: Schema.optional(
		Schema.Array(
			Schema.Struct({
				code: Schema.String,
				period: Schema.String,
				hours: Schema.Number,
				on: Schema.String
			})
		)
	),
	/**
	 * Leave an exit settled on its last payslip, which the payslip posts as days used: what was left is paid out, and
	 * what was taken beyond what the last day earned is taken back (a figure below zero).
	 */
	cash_out: Schema.optional(
		Schema.Array(
			Schema.Struct({
				code: Schema.String,
				period: Schema.String,
				amount: Schema.Number,
				unit: Schema.Literals(['DAY', 'HOUR']),
				on: Schema.String
			})
		)
	)
});

export type PayslipBreakdown = typeof PayslipBreakdown.Type;

export const emptyPayslipBreakdown: PayslipBreakdown = {
	checkpoints: [],
	lines: [],
	statutory: []
};

export const breakdownOf = (result: PayrollResult): PayslipBreakdown => ({
	checkpoints: result.subtotals.map(({ code, name, value }) => ({ code, name, value })),
	lines: result.lines.map(
		({ code, label, subtotal, amount, direction, party, source_id, quantity, unit }) => ({
			code,
			label,
			subtotal,
			amount,
			direction,
			party,
			source: source_id.model,
			...(quantity === undefined ? {} : { quantity }),
			...(unit === undefined ? {} : { unit })
		})
	),
	statutory: result.statutory.map(({ code, kind, employee, employer }) => ({
		code,
		kind,
		employee,
		employer
	})),
	...(result.time_off.length === 0 ? {} : { time_off: result.time_off })
});
