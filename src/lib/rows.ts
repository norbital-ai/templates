import type {
	CollectionName,
	DatePeriod,
	Decimal,
	Instant,
	Masked,
	PlainDate,
	Row
} from '@norbital-ai/bolt';

/** A stored value as the template's domain code reads it once `lib/wire.ts` has made it plain (deeply, as `plain` does). */
type Plain<V> = V extends Decimal
	? number
	: V extends PlainDate | Instant
		? string
		: V extends DatePeriod
			? { readonly from: string; readonly to: string | null }
			: V extends string | number | boolean | null | undefined
				? V
				: V extends readonly (infer E)[]
					? readonly Plain<E>[]
					: V extends object
						? { readonly [K in keyof V]: Plain<V[K]> }
						: V;

/**
 * One stored row of `C` as the domain code reads it: every field unmasked (the transform and the payroll world read
 * as the workspace), decimals as numbers, dates and instants as strings, a date period as its plain ends. Derived
 * from the names index, so a model change reaches every reader.
 */
export type WorkspaceRow<C extends CollectionName> = { readonly id: string } & {
	readonly [P in keyof Row<C>]: Plain<Exclude<Row<C>[P], Masked>>;
};
