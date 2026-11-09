import { Schema } from 'effect';
import type { PayrollResult } from './engine.js';

export const PayslipBreakdown = Schema.Struct({
	checkpoints: Schema.Array(
		Schema.Struct({
			id: Schema.String,
			code: Schema.String,
			name: Schema.String,
			value: Schema.Number
		})
	),
	lines: Schema.Array(
		Schema.Struct({
			code: Schema.String,
			label: Schema.String,
			subtotal_id: Schema.String,
			amount: Schema.Number,
			direction: Schema.String,
			party: Schema.String,
			source: Schema.String,
			quantity: Schema.optional(Schema.Number),
			unit: Schema.optional(Schema.String)
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
	)
});

export type PayslipBreakdown = typeof PayslipBreakdown.Type;

export const emptyPayslipBreakdown: PayslipBreakdown = {
	checkpoints: [],
	lines: [],
	statutory: []
};

export const breakdownOf = (result: PayrollResult): PayslipBreakdown => ({
	checkpoints: result.subtotals.map(({ id, code, name, value }) => ({ id, code, name, value })),
	lines: result.lines.map(
		({ code, label, subtotal_id, amount, direction, party, source_id, quantity, unit }) => ({
			code,
			label,
			subtotal_id,
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
