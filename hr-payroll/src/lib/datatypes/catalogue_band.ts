import { compileExpression } from '../expressions/compile.js';
import { entitlementFault, type Entitlement } from './entitlement.js';

/**
 * One band of a catalogue row: the first band whose `when` holds governs, settling `amount` under
 * the ceiling `limit`. Every expression compiles against the `entry` context at write time.
 */
export type CatalogueBand = {
	/** CEL over the entry context; `''` is every entry. */
	readonly when: string;
	/** Money over the entry context; a plain figure is a valid expression. */
	readonly amount: string;
	readonly limit?: Entitlement | null;
};

export function catalogueBandsFault(bands: readonly CatalogueBand[]): string | undefined {
	for (const band of bands) {
		if (band.amount === '') return 'amount: is required';
		const fault =
			compileExpression({ expression: band.when, site: 'entry', type: 'boolean' }) ??
			compileExpression({ expression: band.amount, site: 'entry', type: 'money' }) ??
			(band.limit == null ? undefined : entitlementFault(band.limit));
		if (fault != null) return fault;
	}
	return undefined;
}
