import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';
import { todayInstant, todayKey } from '../lib/ui/calendar.js';
import type { StatutoryFactStatus } from '../datatypes/statutory_fact_status/+definition.js';

/**
 * In-force statutory alignment: which companies, facts and schemes have drifted, and which
 * employment facts have a unique successor scheme to copy onto.
 *
 * The law tables themselves are never written from here. A successor copy is proposed only when
 * exactly one later in-force scheme exists for the same jurisdiction and code.
 */

export type StoredRange = { readonly start: string; readonly end: string | null };

/** The stored `dateRange()` column shape: a JSONB pair of instants, bounds optional at the type. */
export type RangeValue = { readonly start?: string; readonly end?: string | null };

export type JurisdictionRow = {
	readonly norbital_id: string;
	readonly code: string;
	readonly name: string;
	readonly effective_range: RangeValue | null | undefined;
};

export type SchemeRow = {
	readonly norbital_id: string;
	readonly jurisdiction_id: string;
	readonly code: string;
	readonly name: string;
	readonly effective_range: RangeValue | null | undefined;
};

export type RateRow = {
	readonly norbital_id: string;
	readonly statutory_contribution_id: string;
	readonly summary: string | null;
	readonly effective_range: RangeValue | null | undefined;
};

export type CompanyRow = {
	readonly norbital_id: string;
	readonly name: string;
	readonly jurisdiction_id: string;
	readonly jurisdiction: JurisdictionRow | null;
};

export type EmploymentRow = {
	readonly norbital_id: string;
	readonly employee_number: string;
	readonly company_id: string;
};

export type FactRow = {
	readonly norbital_id: string;
	readonly employment_id: string;
	readonly statutory_contribution_id: string;
	readonly status: StatutoryFactStatus | null;
	readonly summary: string | null;
	readonly effective_range: RangeValue | null | undefined;
	readonly scheme: SchemeRow | null;
};

export type DriftKind =
	'superseded_company_jurisdiction' | 'fact_needs_successor' | 'missing_fact' | 'rate_gap';

export type DriftItem = {
	readonly kind: DriftKind;
	readonly label: string;
};

export type SuccessorCopy = {
	readonly factId: string;
	readonly employmentId: string;
	readonly successorSchemeId: string;
	readonly status: StatutoryFactStatus | null;
	readonly previousRange: StoredRange;
	readonly label: string;
};

function readRange(value: unknown): StoredRange | null {
	if (value == null || typeof value !== 'object') return null;
	const start = Reflect.get(value, 'start');
	if (typeof start !== 'string' || start === '') return null;
	const end = Reflect.get(value, 'end');
	return { start, end: typeof end === 'string' && end !== '' ? end : null };
}

export function coversDate(range: RangeValue | null | undefined, date: string): boolean {
	const parsed = readRange(range);
	if (!parsed) return false;
	if (parsed.start.slice(0, 10) > date) return false;
	return parsed.end == null || parsed.end.slice(0, 10) >= date;
}

function uniqueSuccessorScheme(
	scheme: SchemeRow,
	inForceSchemes: readonly SchemeRow[]
): SchemeRow | null {
	const successors = inForceSchemes.filter(
		(candidate) =>
			candidate.jurisdiction_id === scheme.jurisdiction_id &&
			candidate.code === scheme.code &&
			candidate.norbital_id !== scheme.norbital_id &&
			String(readRange(candidate.effective_range)?.start ?? '') >
				String(readRange(scheme.effective_range)?.start ?? '')
	);
	return successors.length === 1 ? (successors[0] ?? null) : null;
}

/**
 * A relation value arrives through a `with` clause, whose generated type cannot say whether it is
 * a row or a list. The runtime returns the single row or null.
 */
function isRecordRow(
	value:
		| Readonly<Record<string, unknown>>
		| ReadonlyArray<Readonly<Record<string, unknown>>>
		| null
		| undefined
): value is Readonly<Record<string, unknown>> {
	return value != null && !Array.isArray(value);
}

/**
 * A company's jurisdiction arrives through the `company_jurisdiction` relation. The runtime
 * returns the single row or null.
 */
function asJurisdiction(
	value:
		| Readonly<Record<string, unknown>>
		| ReadonlyArray<Readonly<Record<string, unknown>>>
		| null
		| undefined
): JurisdictionRow | null {
	if (!isRecordRow(value)) return null;
	const { norbital_id, code, name, effective_range } = value;
	if (typeof norbital_id !== 'string' || typeof code !== 'string' || typeof name !== 'string') {
		return null;
	}
	return {
		norbital_id,
		code,
		name,
		effective_range: readRange(effective_range)
	};
}

/**
 * A fact's scheme arrives through the `statutory_fact_contribution` relation. The runtime returns
 * the single row or null.
 */
function asScheme(
	value:
		| Readonly<Record<string, unknown>>
		| ReadonlyArray<Readonly<Record<string, unknown>>>
		| null
		| undefined
): SchemeRow | null {
	if (!isRecordRow(value)) return null;
	const { norbital_id, jurisdiction_id, code, name, effective_range } = value;
	if (
		typeof norbital_id !== 'string' ||
		typeof jurisdiction_id !== 'string' ||
		typeof code !== 'string' ||
		typeof name !== 'string'
	) {
		return null;
	}
	return {
		norbital_id,
		jurisdiction_id,
		code,
		name,
		effective_range: readRange(effective_range)
	};
}

export function asFactStatus(value: StatutoryFactStatus | null): StatutoryFactStatus | null {
	if (value == null) return null;
	if (value.kind === 'REGISTERED' && typeof value.reference_number === 'string') return value;
	if (value.kind === 'NOT_REGISTERED' && typeof value.reason === 'string') return value;
	return null;
}

export function detectStatutoryDrift(input: {
	readonly today: string;
	readonly inForceJurisdictions: readonly JurisdictionRow[];
	readonly inForceSchemes: readonly SchemeRow[];
	readonly inForceRates: readonly RateRow[];
	readonly companies: readonly CompanyRow[];
	readonly employments: readonly EmploymentRow[];
	readonly facts: readonly FactRow[];
}): { readonly items: DriftItem[]; readonly copies: SuccessorCopy[] } {
	const items: DriftItem[] = [];
	const copies: SuccessorCopy[] = [];
	const inForceJurisdictionByCode = new Map(
		input.inForceJurisdictions.map((row) => [row.code, row])
	);
	const inForceSchemeIds = new Set(input.inForceSchemes.map((row) => row.norbital_id));
	const schemesByJurisdiction = new Map<string, SchemeRow[]>();
	for (const scheme of input.inForceSchemes) {
		const list = schemesByJurisdiction.get(scheme.jurisdiction_id) ?? [];
		list.push(scheme);
		schemesByJurisdiction.set(scheme.jurisdiction_id, list);
	}
	const ratesByScheme = new Map<string, RateRow[]>();
	for (const rate of input.inForceRates) {
		const list = ratesByScheme.get(rate.statutory_contribution_id) ?? [];
		list.push(rate);
		ratesByScheme.set(rate.statutory_contribution_id, list);
	}

	for (const company of input.companies) {
		const bound = company.jurisdiction;
		if (!bound) continue;
		const current = inForceJurisdictionByCode.get(bound.code);
		if (current && current.norbital_id !== bound.norbital_id) {
			items.push({
				kind: 'superseded_company_jurisdiction',
				label: `${company.name} is still on ${bound.name}; ${current.name} is in force for ${bound.code}`
			});
		}
	}

	for (const scheme of input.inForceSchemes) {
		const rates = (ratesByScheme.get(scheme.norbital_id) ?? []).filter((rate) =>
			coversDate(rate.effective_range, input.today)
		);
		if (rates.length === 0) {
			items.push({
				kind: 'rate_gap',
				label: `${scheme.code} ${scheme.name} has no rate band covering ${input.today}`
			});
		} else if (rates.length > 1) {
			items.push({
				kind: 'rate_gap',
				label: `${scheme.code} ${scheme.name} has overlapping rate bands on ${input.today}`
			});
		}
	}

	const factsByEmployment = new Map<string, FactRow[]>();
	for (const fact of input.facts) {
		const list = factsByEmployment.get(fact.employment_id) ?? [];
		list.push(fact);
		factsByEmployment.set(fact.employment_id, list);
	}

	const companyById = new Map(input.companies.map((row) => [row.norbital_id, row]));

	for (const fact of input.facts) {
		const scheme = fact.scheme;
		if (!scheme) continue;
		if (inForceSchemeIds.has(scheme.norbital_id)) continue;
		const successor = uniqueSuccessorScheme(scheme, input.inForceSchemes);
		const previousRange = readRange(fact.effective_range);
		if (successor && previousRange) {
			copies.push({
				factId: fact.norbital_id,
				employmentId: fact.employment_id,
				successorSchemeId: successor.norbital_id,
				status: fact.status,
				previousRange,
				label: `${fact.summary} → ${successor.code} ${successor.name}`
			});
			items.push({
				kind: 'fact_needs_successor',
				label: `${fact.summary} can move onto ${successor.code} ${successor.name}`
			});
		} else {
			items.push({
				kind: 'fact_needs_successor',
				label: `${fact.summary} sits on a scheme that is not in force; successor is ambiguous or missing`
			});
		}
	}

	for (const employment of input.employments) {
		const company = companyById.get(employment.company_id);
		const jurisdictionId = company?.jurisdiction
			? (inForceJurisdictionByCode.get(company.jurisdiction.code)?.norbital_id ??
				company.jurisdiction.norbital_id)
			: null;
		if (!jurisdictionId) continue;
		const levied = schemesByJurisdiction.get(jurisdictionId) ?? [];
		const standing = new Set(
			(factsByEmployment.get(employment.norbital_id) ?? []).flatMap((fact) => {
				if (!fact.scheme || !inForceSchemeIds.has(fact.scheme.norbital_id)) return [];
				return [fact.scheme.code];
			})
		);
		for (const scheme of levied) {
			if (standing.has(scheme.code)) continue;
			items.push({
				kind: 'missing_fact',
				label: `Employment ${employment.employee_number} has no fact for ${scheme.code} ${scheme.name}`
			});
		}
	}

	return { items, copies };
}

const reportSchema = Schema.Struct({
	summary: Schema.String,
	highlights: Schema.Array(Schema.String)
});

export default defineAutomation(
	{ schedule: '0 3 * * 1' },
	{
		/**
		 * The authority every run of this automation acts under.
		 *
		 * Its own, not its trigger's. This used to inherit whoever tripped it — so the same nightly
		 * sweep ran as an administrator when an administrator happened to start it, and as a contractor
		 * otherwise, over a different set of rows each time. Naming it here is what makes "what can this
		 * automation touch" a question with an answer that does not depend on the day.
		 */
		policies: ['hr_controller'],
		description:
			'Weekly check that in-force statutory snapshots, contribution schemes and employment statutory facts still line up — successor facts only when a unique scheme successor exists.',
		handler: (api) =>
			Effect.gen(function* () {
				const today = todayKey();
				const asOf = todayInstant();
				const live = {
					norbital_approval_id: { isNull: true },
					effective_range: { contains_date: asOf }
				};
				const [inForceJurisdictions, inForceSchemes, inForceRates, companies, employments, facts] =
					yield* Effect.all(
						[
							api.db.query.jurisdictions.findMany({
								where: live,
								columns: { norbital_id: true, code: true, name: true, effective_range: true },
								limit: 250
							}),
							api.db.query.statutory_contributions.findMany({
								where: live,
								columns: {
									norbital_id: true,
									jurisdiction_id: true,
									code: true,
									name: true,
									effective_range: true
								},
								limit: 250
							}),
							api.db.query.contribution_rates.findMany({
								where: live,
								columns: {
									norbital_id: true,
									statutory_contribution_id: true,
									summary: true,
									effective_range: true
								},
								limit: 250
							}),
							api.db.query.companies.findMany({
								where: live,
								columns: { norbital_id: true, name: true, jurisdiction_id: true },
								with: {
									company_jurisdiction: {
										columns: { norbital_id: true, code: true, name: true, effective_range: true }
									}
								},
								limit: 250
							}),
							api.db.query.employments.findMany({
								where: live,
								columns: { norbital_id: true, employee_number: true, company_id: true },
								limit: 250
							}),
							api.db.query.employment_statutory_facts.findMany({
								where: live,
								columns: {
									norbital_id: true,
									employment_id: true,
									statutory_contribution_id: true,
									status: true,
									summary: true,
									effective_range: true
								},
								with: {
									statutory_fact_contribution: {
										columns: {
											norbital_id: true,
											jurisdiction_id: true,
											code: true,
											name: true,
											effective_range: true
										}
									}
								},
								limit: 250
							})
						],
						{ concurrency: 'unbounded' }
					);

				const detected = detectStatutoryDrift({
					today,
					inForceJurisdictions,
					inForceSchemes,
					inForceRates,
					companies: companies.map((company) => ({
						norbital_id: company.norbital_id,
						name: company.name,
						jurisdiction_id: company.jurisdiction_id,
						jurisdiction: asJurisdiction(company.company_jurisdiction)
					})),
					employments,
					facts: facts.map((fact) => ({
						norbital_id: fact.norbital_id,
						employment_id: fact.employment_id,
						statutory_contribution_id: fact.statutory_contribution_id,
						status: fact.status,
						summary: fact.summary,
						effective_range: fact.effective_range,
						scheme: asScheme(fact.statutory_fact_contribution)
					}))
				});

				const writes: string[] = [];
				for (const copy of detected.copies) {
					const already = facts.find(
						(fact) =>
							fact.employment_id === copy.employmentId &&
							fact.statutory_contribution_id === copy.successorSchemeId
					);
					if (already) continue;
					const status = asFactStatus(copy.status);
					if (!status) continue;
					yield* api.db.employment_statutory_facts.update(copy.factId, {
						effective_range: { start: copy.previousRange.start, end: asOf }
					});
					yield* api.db.employment_statutory_facts.create({
						employment_id: copy.employmentId,
						statutory_contribution_id: copy.successorSchemeId,
						status,
						effective_range: { start: asOf }
					});
					writes.push(copy.label);
				}

				if (detected.items.length === 0 && writes.length === 0) {
					return { status: 'ok', checked_on: today, items: 0, writes: 0 };
				}

				const report = yield* api.infer({
					schema: reportSchema,
					prompt: [
						'Write a short weekly statutory-alignment report from these already-computed findings.',
						'Name records in prose. Do not invent law, IDs, or extra drift.',
						'Findings:',
						...detected.items.map((item) => `- ${item.kind}: ${item.label}`),
						writes.length > 0
							? `Successor copies performed:\n${writes.map((label) => `- ${label}`).join('\n')}`
							: 'No successor copies were performed.'
					].join('\n')
				});

				return {
					status: 'ok',
					checked_on: today,
					items: detected.items.length,
					writes: writes.length,
					summary: report.summary,
					highlights: report.highlights
				};
			})
	}
);
