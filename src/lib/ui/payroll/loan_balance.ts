import * as Predicate from 'effect/Predicate';
import { moneyNumber } from '../../payroll_engine/foundation.js';

/** One loan instalment as the balance reads it: its loan (`facts.loan_id`, `facts.principal`), day and amount. */
export type Instalment = {
	readonly id: string;
	readonly employment_id: unknown;
	readonly catalog_id: unknown;
	readonly occurred_on: unknown;
	readonly activity?: unknown;
	readonly amount?: unknown;
	readonly facts?: unknown;
};

const factOf = (facts: unknown, key: string): unknown =>
	Predicate.isObject(facts) ? Reflect.get(facts, key) : undefined;
const idOf = (value: unknown): string =>
	Predicate.isObject(value) && 'id' in value ? String(value.id) : String(value ?? '');

/**
 * Each instalment's outstanding balance once it is recovered: the loan's principal (`facts.principal`) less every
 * instalment of the same loan (`facts.loan_id`, else the employment's class) on or before it, a REVERSAL giving one
 * back, and the instalments its first recorded one's `facts.sequence` says came before. An instalment of a loan with
 * no principal recorded has none (null).
 */
export function loanBalances(rows: readonly Instalment[]): ReadonlyMap<string, number | null> {
	const loans = new Map<string, Instalment[]>();
	for (const row of rows) {
		const loan = factOf(row.facts, 'loan_id');
		const key = loan == null ? `${idOf(row.employment_id)}:${idOf(row.catalog_id)}` : String(loan);
		loans.set(key, [...(loans.get(key) ?? []), row]);
	}
	const out = new Map<string, number | null>();
	for (const list of loans.values()) {
		const ordered = list.toSorted(
			(a, b) =>
				String(a.occurred_on).localeCompare(String(b.occurred_on)) || a.id.localeCompare(b.id)
		);
		const principal = ordered
			.map((row) => moneyNumber(factOf(row.facts, 'principal')))
			.find((value) => value != null);
		// a loan brought over mid-repayment names each instalment's `facts.sequence`: the instalments before the first
		// one recorded are taken at its amount (ponytail: equal instalments; record a carried balance if they were not)
		const first = ordered[0];
		const sequence = moneyNumber(factOf(first?.facts, 'sequence'));
		const unrecorded = sequence == null ? 0 : Math.max(0, sequence - 1);
		let left = (principal ?? 0) - unrecorded * (moneyNumber(first?.amount) ?? 0);
		for (const row of ordered) {
			const amount = moneyNumber(row.amount) ?? 0;
			left = Math.round((left - (row.activity === 'REVERSAL' ? -amount : amount)) * 100) / 100;
			out.set(row.id, principal == null ? null : left);
		}
	}
	return out;
}
