import { Schema } from 'effect';

/** Shared runtime contracts: plain JSON, money units, parties and expression context roots. */
export const JsonObject = Schema.Record(Schema.String, Schema.Json);
export type JsonObject = typeof JsonObject.Type;
export const UNITS = ['DAY', 'CALENDAR_DAY', 'HOUR', 'MONEY', 'COUNT'] as const;
export type Unit = (typeof UNITS)[number];
export type Party = 'EMPLOYEE' | 'EMPLOYER';
export type Direction = 'ADD' | 'DEDUCT';
export interface Period {
	readonly from: string;
	readonly to: string;
}

export const Lookup = Schema.Record(Schema.String, Schema.Json);
export type Lookup = typeof Lookup.Type;
/** Constants belong to their expression owner; no inherited or merged lookup. */
export const lookupOf = (owner: { readonly lookup?: unknown }): Lookup =>
	Schema.decodeUnknownSync(Lookup)(owner.lookup ?? {});

const Rounding = Schema.Struct({
	mode: Schema.Literals(['HALF_UP', 'HALF_EVEN', 'UP', 'DOWN', 'TRUNCATE']),
	scale: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 12 }))
});
export type Rounding = typeof Rounding.Type;

export type Phase = 'CALCULATION' | 'EXPORT';
const CALCULATION_ROOTS = [
	'subject',
	'entry',
	'lookup',
	'balances',
	'base_pay',
	'calendar_days',
	'working_days',
	'month_wage',
	'day_rate',
	'hour_rate',
	'paid_share',
	'used',
	'subtotals',
	'overtime',
	'statutory',
	'allowance',
	'run',
	'references',
	'components',
	'configuration',
	'work',
	'event',
	'reads',
	'as_of',
	// an effect compares the row before and after the write; the dispatch context already carries both
	'before',
	'after'
] as const;
/** Parse-time and run-time expression access is limited to these actual PIT inputs. */
export const PHASE_ROOTS: Readonly<Record<Phase, readonly string[]>> = {
	CALCULATION: CALCULATION_ROOTS,
	EXPORT: [
		'company',
		'employee',
		'contract',
		'slips',
		'entries',
		'totals',
		'rows',
		'items',
		'item',
		'index',
		'count',
		'key',
		'generated_at',
		'currency',
		'lookup'
	]
};

/**
 * The constants one settings row gives an expression: its shared rate tables plus the typed conversions under the names
 * the stored formulas already use. `ctx.lookup` is this view.
 */
export const settingsConstants = (settings: JsonObject): Lookup => {
	const lookup = lookupOf(settings);
	const constants = isPlainObject(lookup.constants) ? lookup.constants : {};
	const conversions = isPlainObject(settings.conversions) ? settings.conversions : {};
	const day = isPlainObject(conversions.day) ? conversions.day : null;
	const hour = isPlainObject(conversions.hour) ? conversions.hour : null;
	const rounding = isPlainObject(conversions.rounding) ? conversions.rounding : {};
	const ledger = isPlainObject(settings.ledger) ? settings.ledger : {};
	return {
		...lookup,
		...constants,
		day_basis: day,
		hour_basis: hour,
		proration_basis: conversions.proration ?? null,
		rounding: rounding.mode ?? 'HALF_UP',
		rounding_scale: typeof rounding.scale === 'number' ? rounding.scale : 2,
		ytd_scope: ledger.ytd_scope === 'EMPLOYER' ? 'EMPLOYER' : 'JURISDICTION'
	};
};
const isPlainObject = (value: unknown): value is Lookup =>
	value !== null && typeof value === 'object' && !Array.isArray(value);
