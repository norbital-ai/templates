import { defineAutomation } from '@norbital-ai/bolt/authoring';
import { Effect, Option, Schema } from 'effect';
import { todayInstant, todayKey } from '../lib/ui/calendar.js';
import {
	statutoryFactStatusValueSchema,
	type StatutoryFactStatus
} from '../datatypes/statutory_fact_status/+definition.js';
import {
	readRange,
	StoredRangeSchema,
	type StoredRange
} from '../collections/payroll_runs/lib/effective.js';

/**
 * In-force statutory alignment: which companies, facts and schemes have drifted, and which
 * employment facts have a unique successor scheme to copy onto.
 *
 * The law tables themselves are never written from here. A successor copy is proposed only when
 * exactly one later in-force scheme exists for the same jurisdiction and code.
 */

const DriftKindSchema = Schema.Union([
	Schema.Literal('superseded_company_jurisdiction'),
	Schema.Literal('fact_needs_successor'),
	Schema.Literal('missing_fact'),
	Schema.Literal('rate_gap')
]);
export type DriftKind = Schema.Schema.Type<typeof DriftKindSchema>;

const DriftItemSchema = Schema.Struct({ kind: DriftKindSchema, label: Schema.String });
export type DriftItem = Schema.Schema.Type<typeof DriftItemSchema>;

const SuccessorCopySchema = Schema.Struct({
	factId: Schema.String,
	employmentId: Schema.String,
	successorSchemeId: Schema.String,
	status: Schema.NullOr(statutoryFactStatusValueSchema),
	previousRange: StoredRangeSchema,
	label: Schema.String
});
export type SuccessorCopy = Schema.Schema.Type<typeof SuccessorCopySchema>;

/**
 * A relation value arrives through a `with` clause, whose generated type cannot say whether it is
 * a row or a list. The runtime returns the single row or null; both shapes below are that row.
 */
const jurisdictionValueSchema = Schema.Struct({
	id: Schema.String,
	code: Schema.String,
	name: Schema.String,
	effective_range: Schema.optionalKey(Schema.Unknown)
});
export type JurisdictionRow = Schema.Schema.Type<typeof jurisdictionValueSchema>;

const schemeValueSchema = Schema.Struct({
	id: Schema.String,
	jurisdiction_id: Schema.String,
	code: Schema.String,
	name: Schema.String,
	effective_range: Schema.optionalKey(Schema.Unknown)
});
export type SchemeRow = Schema.Schema.Type<typeof schemeValueSchema>;

const RateRowSchema = Schema.Struct({
	id: Schema.String,
	statutory_contribution_id: Schema.String,
	summary: Schema.NullOr(Schema.String),
	effective_range: Schema.optionalKey(Schema.Unknown)
});
export type RateRow = Schema.Schema.Type<typeof RateRowSchema>;

const CompanyRowSchema = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	jurisdiction_id: Schema.String,
	jurisdiction: Schema.NullOr(jurisdictionValueSchema)
});
export type CompanyRow = Schema.Schema.Type<typeof CompanyRowSchema>;

const EmploymentRowSchema = Schema.Struct({
	id: Schema.String,
	employee_number: Schema.String,
	company_id: Schema.String
});
export type EmploymentRow = Schema.Schema.Type<typeof EmploymentRowSchema>;

const FactRowSchema = Schema.Struct({
	id: Schema.String,
	employment_id: Schema.String,
	statutory_contribution_id: Schema.String,
	status: Schema.NullOr(statutoryFactStatusValueSchema),
	summary: Schema.NullOr(Schema.String),
	effective_range: Schema.optionalKey(Schema.Unknown),
	scheme: Schema.NullOr(schemeValueSchema)
});
export type FactRow = Schema.Schema.Type<typeof FactRowSchema>;

export function coversDate(range: unknown, date: string): boolean {
	const parsed = readRange(range);
	if (!parsed) return false;
	if (parsed.start.slice(0, 10) > date) return false;
	return parsed.end == null || parsed.end.slice(0, 10) >= date;
}

const decodeJurisdiction = Schema.decodeUnknownOption(jurisdictionValueSchema);
const decodeScheme = Schema.decodeUnknownOption(schemeValueSchema);
const decodeFactStatus = Schema.decodeUnknownOption(statutoryFactStatusValueSchema);

/**
 * A company's jurisdiction arrives through the `company_jurisdiction` relation. The runtime
 * returns the single row or null.
 */
function asJurisdiction(value: unknown): JurisdictionRow | null {
	const parsed = Option.getOrNull(decodeJurisdiction(value));
	return parsed == null ? null : { ...parsed, effective_range: readRange(parsed.effective_range) };
}

/**
 * A fact's scheme arrives through the `statutory_fact_contribution` relation. The runtime returns
 * the single row or null.
 */
function asScheme(value: unknown): SchemeRow | null {
	const parsed = Option.getOrNull(decodeScheme(value));
	return parsed == null ? null : { ...parsed, effective_range: readRange(parsed.effective_range) };
}

export function asFactStatus(value: StatutoryFactStatus | null): StatutoryFactStatus | null {
	return value == null ? null : Option.getOrNull(decodeFactStatus(value));
}

const DriftDetectionInputSchema = Schema.Struct({
	today: Schema.String,
	inForceJurisdictions: Schema.Array(jurisdictionValueSchema),
	inForceSchemes: Schema.Array(schemeValueSchema),
	inForceRates: Schema.Array(RateRowSchema),
	companies: Schema.Array(CompanyRowSchema),
	employments: Schema.Array(EmploymentRowSchema),
	facts: Schema.Array(FactRowSchema)
});
type DriftDetectionInput = Schema.Schema.Type<typeof DriftDetectionInputSchema>;

/**
 * A scheme successor is the unique later in-force scheme of the same jurisdiction and code. The
 * jurisdiction identity is carried by the `candidates` index; only code and date order remain.
 */
function uniqueSuccessorScheme(
	scheme: SchemeRow,
	candidates: readonly SchemeRow[]
): SchemeRow | null {
	const successors = candidates.filter(
		(candidate) =>
			candidate.code === scheme.code &&
			candidate.id !== scheme.id &&
			String(readRange(candidate.effective_range)?.start ?? '') >
				String(readRange(scheme.effective_range)?.start ?? '')
	);
	return successors.length === 1 ? (successors[0] ?? null) : null;
}

export function detectStatutoryDrift(input: DriftDetectionInput): {
	readonly items: DriftItem[];
	readonly copies: SuccessorCopy[];
} {
	const items: DriftItem[] = [];
	const copies: SuccessorCopy[] = [];
	const inForceJurisdictionByCode = new Map(
		input.inForceJurisdictions.map((row) => [row.code, row])
	);
	const inForceSchemeIds = new Set(input.inForceSchemes.map((row) => row.id));
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
		if (current && current.id !== bound.id) {
			items.push({
				kind: 'superseded_company_jurisdiction',
				label: `${company.name} is still on ${bound.name}; ${current.name} is in force for ${bound.code}`
			});
		}
	}

	for (const scheme of input.inForceSchemes) {
		const rates = (ratesByScheme.get(scheme.id) ?? []).filter((rate) =>
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

	const companyById = new Map(input.companies.map((row) => [row.id, row]));

	for (const fact of input.facts) {
		const scheme = fact.scheme;
		if (!scheme) continue;
		if (inForceSchemeIds.has(scheme.id)) continue;
		const successor = uniqueSuccessorScheme(
			scheme,
			schemesByJurisdiction.get(scheme.jurisdiction_id) ?? []
		);
		const previousRange = readRange(fact.effective_range);
		if (successor && previousRange) {
			copies.push({
				factId: fact.id,
				employmentId: fact.employment_id,
				successorSchemeId: successor.id,
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
			? (inForceJurisdictionByCode.get(company.jurisdiction.code)?.id ?? company.jurisdiction.id)
			: null;
		if (!jurisdictionId) continue;
		const levied = schemesByJurisdiction.get(jurisdictionId) ?? [];
		const standing = new Set(
			(factsByEmployment.get(employment.id) ?? []).flatMap((fact) => {
				if (!fact.scheme || !inForceSchemeIds.has(fact.scheme.id)) return [];
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
					approval_id: { isNull: true },
					effective_range: { contains_date: asOf }
				};
				const [inForceJurisdictions, inForceSchemes, inForceRates, companies, employments, facts] =
					yield* Effect.all(
						[
							api.db.query.jurisdictions.findMany({
								where: live,
								columns: { id: true, code: true, name: true, effective_range: true },
								limit: 250
							}),
							api.db.query.statutory_contributions.findMany({
								where: live,
								columns: {
									id: true,
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
									id: true,
									statutory_contribution_id: true,
									summary: true,
									effective_range: true
								},
								limit: 250
							}),
							api.db.query.companies.findMany({
								where: live,
								columns: { id: true, name: true, jurisdiction_id: true },
								with: {
									company_jurisdiction: {
										columns: { id: true, code: true, name: true, effective_range: true }
									}
								},
								limit: 250
							}),
							api.db.query.employments.findMany({
								where: live,
								columns: { id: true, employee_number: true, company_id: true },
								limit: 250
							}),
							api.db.query.employment_statutory_facts.findMany({
								where: live,
								columns: {
									id: true,
									employment_id: true,
									statutory_contribution_id: true,
									status: true,
									summary: true,
									effective_range: true
								},
								with: {
									statutory_fact_contribution: {
										columns: {
											id: true,
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
						id: company.id,
						name: company.name,
						jurisdiction_id: company.jurisdiction_id,
						jurisdiction: asJurisdiction(company.company_jurisdiction)
					})),
					employments,
					facts: facts.map((fact) => ({
						id: fact.id,
						employment_id: fact.employment_id,
						statutory_contribution_id: fact.statutory_contribution_id,
						status: fact.status,
						summary: fact.summary,
						effective_range: fact.effective_range,
						scheme: asScheme(fact.statutory_fact_contribution)
					}))
				});

				const writes: string[] = [];
				const existingSchemeIdsByEmployment = new Map<string, Set<string>>();
				for (const fact of facts) {
					const schemeIds =
						existingSchemeIdsByEmployment.get(fact.employment_id) ?? new Set<string>();
					schemeIds.add(fact.statutory_contribution_id);
					existingSchemeIdsByEmployment.set(fact.employment_id, schemeIds);
				}
				for (const copy of detected.copies) {
					if (existingSchemeIdsByEmployment.get(copy.employmentId)?.has(copy.successorSchemeId)) {
						continue;
					}
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
