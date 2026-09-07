/** Payroll reads approved time-off applications for absence pricing. Entitlement accounting lives in leave_entitlements/leave_entries. */
import { Schema } from 'effect';
import type { WorkspaceRow } from '../$types.js';
import type { Configuration } from './configuration.js';
import { dateKey, type IsoDate } from './dates.js';
import type { PayrollWindow } from './period.js';
import { decodeNumber } from '@norbital-ai/std/json';

export type ChildFact = WorkspaceRow<'employee_children'>;

const LedgerRowSchema = Schema.Struct({
	id: Schema.String,
	leave_type_id: Schema.String,
	entry_date: Schema.String,
	through_date: Schema.optionalKey(Schema.NullOr(Schema.String)),
	kind: Schema.NullOr(Schema.String),
	days: Schema.Number,
	source_id: Schema.NullOr(Schema.String),
	approval_id: Schema.optionalKey(Schema.NullOr(Schema.String))
});
export type LedgerRow = Schema.Schema.Type<typeof LedgerRowSchema>;

/** The leave year is the calendar year. */
export function leaveYearOf(date: IsoDate): number {
	return Number(date.slice(0, 4));
}

const UnpaidLeaveSchema = Schema.Struct({
	componentId: Schema.String,
	days: Schema.Number,
	requests: Schema.Array(Schema.Struct({ id: Schema.String, days: Schema.Number }))
});
export type UnpaidLeave = Schema.Schema.Type<typeof UnpaidLeaveSchema>;

type UnpaidLeaveInWindowOptions = {
	readonly ledger: readonly LedgerRow[];
	readonly window: PayrollWindow['salary'];
	readonly configuration: Pick<Configuration, 'leaveTypes'>;
};

export function unpaidLeaveInWindow(options: UnpaidLeaveInWindowOptions): UnpaidLeave[] {
	const typeById = new Map(options.configuration.leaveTypes.map((type) => [type.id, type]));
	const byComponent = new Map<string, { days: number; requests: Map<string, number> }>();
	for (const row of options.ledger) {
		if (row.kind !== 'TAKEN' || row.approval_id != null) continue;
		const date = dateKey(row.entry_date);
		if (date == null) continue;
		if (date < options.window.start || date > options.window.end) continue;
		const effect = typeById.get(row.leave_type_id)?.payroll_effect;
		if (effect == null || effect.kind !== 'UNPAID') continue;
		const bucket = byComponent.get(effect.component_id) ?? {
			days: 0,
			requests: new Map<string, number>()
		};
		const days = Math.abs(decodeNumber(row.days));
		bucket.days += days;
		if (row.source_id != null)
			bucket.requests.set(row.source_id, (bucket.requests.get(row.source_id) ?? 0) + days);
		byComponent.set(effect.component_id, bucket);
	}
	return [...byComponent].map(([componentId, bucket]) => ({
		componentId,
		days: bucket.days,
		requests: [...bucket.requests].map(([id, days]) => ({ id, days }))
	}));
}
