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
export type EngineStore = Readonly<Record<string, readonly JsonObject[]>>;

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
	'subtotals',
	'overtime',
	'statutory',
	'run',
	'history',
	'references',
	'components',
	'configuration',
	'work',
	'event',
	'reads',
	'as_of'
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
