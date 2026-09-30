import { factValueFault, type FactKey } from './datatypes/fact_keys.js';

/**
 * (`declarations` are stored `fact_keys` values: the 0.0.1 row type spells an absent member `null`, the schema type
 * leaves it out; the reads below are null-safe.)
 *
 * Entity facts are judged against every sealed live version of the company's lineage: a company spans versions, so a
 * write admits a value some version of its lineage declares; calculations apply the exact constraints and required
 * fields of the version governing their date. The refusal, or null.
 */
export function entityFactsFault(
	code: string,
	values: Readonly<Record<string, unknown>>,
	declarations: readonly object[]
): string | null {
	for (const [key, value] of Object.entries(values)) {
		const matches = (declarations as readonly FactKey[]).filter((field) => field.key === key);
		if (matches.length === 0) return `${code} does not declare the entity fact ${key}.`;
		const faults = matches.map((field) => factValueFault(field, value));
		if (faults.every((fault) => fault != null)) return `${code}: ${faults[0]}`;
	}
	return null;
}

/** The sealed, live, unheld versions of these lineages: the read both entity-fact writers make. */
export const sealedLineages = (codes: readonly string[]) =>
	({
		where: {
			code: { in: [...codes] },
			sealed_at: { isNull: false },
			voided_at: { isNull: true },
			approval_id: { isNull: true }
		},
		all: true
	}) as const;

/** The declared schemas a subject's `facts` are judged against, by the subject collection. */
export const SUBJECT_SCHEMA = {
	company_facts: 'facts',
	employment_terms: 'terms_facts',
	work_days: 'work_day_facts',
	payment_events: 'payment_facts',
	noncontract_settlements: 'settlement_facts'
} as const;
export type FactSubject = keyof typeof SUBJECT_SCHEMA;

/**
 * One evidence row against the declarations of its subject's lineage: some declaration of the key
 * must demand evidence, and the row must carry what that declaration names. The refusal, or null.
 */
export function evidenceFault(
	code: string,
	key: string,
	evidence: { readonly reference?: string | null | undefined; readonly file?: unknown },
	declarations: readonly object[]
): string | null {
	const demands = (declarations as readonly FactKey[]).flatMap((field) =>
		field.key === key && field.evidence != null ? [field.evidence.kind] : []
	);
	if (demands.length === 0) return `${code} declares no evidence for the fact ${key}.`;
	const reference = (evidence.reference ?? '').trim() !== '';
	const file = evidence.file != null && evidence.file !== '';
	const met = demands.some(
		(kind) =>
			(kind !== 'FILE' || file) &&
			(kind !== 'REFERENCE' || reference) &&
			(kind !== 'REFERENCE_AND_FILE' || (reference && file))
	);
	return met
		? null
		: `The evidence for ${key} needs ${demands[0]!.toLowerCase().replaceAll('_', ' ')}.`;
}
