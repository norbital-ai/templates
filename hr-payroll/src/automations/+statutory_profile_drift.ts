import { defineAutomation, type AutomationApi } from '@norbital-ai/bolt/authoring';
import { Clock, Effect, Option, Schema } from 'effect';
import { todayInstant, todayKey } from '../lib/ui/calendar.js';
import { instantAt } from '../lib/iso-day.js';
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

const DRIFT_KINDS: ReadonlyArray<DriftKind> = [
	'superseded_company_jurisdiction',
	'fact_needs_successor',
	'missing_fact',
	'rate_gap'
];
const MAX_RESEARCH_SAMPLES_PER_KIND = 4;
const MAX_RESEARCH_FINDING_LABEL_CHARS = 600;
export const STATUTORY_RESEARCH_MODEL = 'openai/gpt-4.1-mini';

/**
 * Keep tenant-local structural findings useful to research without asking the model to restate
 * hundreds of employment rows. The complete findings remain in the durable run receipt; inference
 * receives counts plus deterministic representative samples for each kind.
 */
export function statutoryResearchFindingContext(items: readonly DriftItem[]): readonly string[] {
	const lines = [
		`- Total local structural findings: ${items.length}. The complete set is stored in the tenant receipt and must not be enumerated in the answer.`
	];
	for (const kind of DRIFT_KINDS) {
		const matching = items.filter((item) => item.kind === kind);
		if (matching.length === 0) continue;
		lines.push(`- ${kind}: ${matching.length}`);
		for (const item of matching.slice(0, MAX_RESEARCH_SAMPLES_PER_KIND)) {
			lines.push(
				`  - sample: ${
					item.label.length <= MAX_RESEARCH_FINDING_LABEL_CHARS
						? item.label
						: `${item.label.slice(0, MAX_RESEARCH_FINDING_LABEL_CHARS - 12)}…[clipped]`
				}`
			);
		}
	}
	return lines;
}

export const SuccessorCopySchema = Schema.Struct({
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
	currency: Schema.optionalKey(Schema.String),
	tax_year_start_month: Schema.optionalKey(Schema.Number),
	proration: Schema.optionalKey(Schema.Unknown),
	ordinary_rate_basis: Schema.optionalKey(Schema.String),
	ordinary_rate_divisor: Schema.optionalKey(Schema.Unknown),
	regime: Schema.optionalKey(Schema.Unknown),
	effective_range: Schema.optionalKey(Schema.Unknown)
});
export type JurisdictionRow = Schema.Schema.Type<typeof jurisdictionValueSchema>;

const schemeValueSchema = Schema.Struct({
	id: Schema.String,
	jurisdiction_id: Schema.String,
	code: Schema.String,
	name: Schema.String,
	authority: Schema.optionalKey(Schema.String),
	payer: Schema.optionalKey(Schema.String),
	keyed_by: Schema.optionalKey(Schema.String),
	rounding: Schema.optionalKey(Schema.String),
	special_rules: Schema.optionalKey(Schema.Unknown),
	overtime_treatments: Schema.optionalKey(Schema.Unknown),
	overtime_excess_treatments: Schema.optionalKey(Schema.Unknown),
	effective_range: Schema.optionalKey(Schema.Unknown)
});
export type SchemeRow = Schema.Schema.Type<typeof schemeValueSchema>;

const RateRowSchema = Schema.Struct({
	id: Schema.String,
	statutory_contribution_id: Schema.String,
	summary: Schema.NullOr(Schema.String),
	selector: Schema.optionalKey(Schema.Unknown),
	award: Schema.optionalKey(Schema.Unknown),
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

const conciseText = (maximum: number) =>
	Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(maximum)));

const OfficialSourceSchema = Schema.Struct({
	title: conciseText(240),
	url: conciseText(1_000),
	jurisdiction_code: conciseText(12),
	finding: conciseText(600)
});

const ChangeToReviewSchema = Schema.Struct({
	jurisdiction_code: conciseText(12),
	subject: conciseText(240),
	current_local_value: conciseText(600),
	latest_official_value: conciseText(600),
	rationale: conciseText(1_000),
	source_url: conciseText(1_000)
});

export const StatutoryResearchReportSchema = Schema.Struct({
	summary: conciseText(1_200),
	highlights: Schema.Array(conciseText(400)).pipe(Schema.check(Schema.isMaxLength(8))),
	official_sources: Schema.Array(OfficialSourceSchema).pipe(Schema.check(Schema.isMaxLength(12))),
	changes_to_review: Schema.Array(ChangeToReviewSchema).pipe(Schema.check(Schema.isMaxLength(12)))
});
export type StatutoryResearchReport = Schema.Schema.Type<typeof StatutoryResearchReportSchema>;

const JurisdictionResearchReportSchema = Schema.Struct({
	summary: conciseText(800),
	highlights: Schema.Array(conciseText(400)).pipe(Schema.check(Schema.isMaxLength(3))),
	official_sources: Schema.Array(OfficialSourceSchema).pipe(Schema.check(Schema.isMaxLength(4))),
	changes_to_review: Schema.Array(ChangeToReviewSchema).pipe(Schema.check(Schema.isMaxLength(4)))
});

const StatutoryProfileDriftInputSchema = Schema.Struct({});
const StatutoryProfileDriftOutputSchema = Schema.Struct({
	status: Schema.Literal('ok'),
	run_log_id: Schema.String,
	checked_on: Schema.String,
	items: Schema.Number,
	proposals: Schema.Number,
	summary: Schema.String,
	highlights: Schema.Array(Schema.String),
	official_sources: Schema.Array(OfficialSourceSchema),
	changes_to_review: Schema.Array(ChangeToReviewSchema)
});

const OFFICIAL_STATUTORY_DOMAINS = [
	'gov.sg',
	'cpf.gov.sg',
	'iras.gov.sg',
	'mom.gov.sg',
	'skillsfuture.gov.sg',
	'myskillsfuture.gov.sg',
	'kwsp.gov.my',
	'perkeso.gov.my',
	'hasil.gov.my',
	'mohr.gov.my',
	'gov.ph',
	'bir.gov.ph',
	'dole.gov.ph',
	'sss.gov.ph',
	'philhealth.gov.ph',
	'pagibigfund.gov.ph',
	'go.id',
	'pajak.go.id',
	'kemnaker.go.id',
	'bpjsketenagakerjaan.go.id',
	'bpjs-kesehatan.go.id',
	'gov.tw',
	'mol.gov.tw',
	'bli.gov.tw',
	'nhi.gov.tw',
	'etax.nat.gov.tw',
	'hrdcorp.gov.my',
	'gov.vn',
	'baohiemxahoi.gov.vn',
	'gdt.gov.vn',
	'moj.gov.vn',
	'dichvucong.gov.vn',
	'mof.gov.vn'
] as const;

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const officialUrl = (value: string): URL | null => {
	if (!URL.canParse(value)) return null;
	const parsed = new URL(value);
	if (parsed.protocol !== 'https:') return null;
	const hostname = parsed.hostname.toLocaleLowerCase();
	if (
		!OFFICIAL_STATUTORY_DOMAINS.some(
			(domain) => hostname === domain || hostname.endsWith(`.${domain}`)
		)
	) {
		return null;
	}
	return parsed;
};

/**
 * Identifies one cited page while tolerating URL spelling that does not change the resource.
 * Models and search providers commonly vary a leading `www`, a terminal slash, fragment, or query
 * parameter ordering. Query values remain part of the identity because official portals often use
 * them as the document id.
 */
const officialSourceIdentity = (url: URL): string => {
	url.hash = '';
	url.hostname = url.hostname.replace(/^www\./, '');
	if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, '');
	url.searchParams.sort();
	return url.href;
};

/** Refuses a model answer that cannot serve as an auditable official-source receipt. */
export function validateResearchReceipt(
	report: StatutoryResearchReport,
	jurisdictionCodes: readonly string[]
): StatutoryResearchReport {
	const expectedJurisdictions = new Set(
		jurisdictionCodes.map((value) => value.toLocaleUpperCase())
	);
	const officialUrls = new Set<string>();
	const sourceJurisdictionsByUrl = new Map<string, Set<string>>();
	const sourcedJurisdictions = new Set<string>();
	for (const source of report.official_sources) {
		const parsed = officialUrl(source.url);
		if (!parsed) {
			throw new Error(`Research source is not an allowed official HTTPS URL: ${source.url}`);
		}
		const jurisdictionCode = source.jurisdiction_code.toLocaleUpperCase();
		if (expectedJurisdictions.size > 0 && !expectedJurisdictions.has(jurisdictionCode)) {
			throw new Error(`Research source names unconfigured jurisdiction ${jurisdictionCode}`);
		}
		const identity = officialSourceIdentity(parsed);
		officialUrls.add(identity);
		const sourceJurisdictions = sourceJurisdictionsByUrl.get(identity) ?? new Set<string>();
		sourceJurisdictions.add(jurisdictionCode);
		sourceJurisdictionsByUrl.set(identity, sourceJurisdictions);
		sourcedJurisdictions.add(jurisdictionCode);
	}

	for (const code of expectedJurisdictions) {
		if (!sourcedJurisdictions.has(code)) {
			throw new Error(`Research receipt has no official source for jurisdiction ${code}`);
		}
	}

	for (const change of report.changes_to_review) {
		const parsed = officialUrl(change.source_url);
		const identity = parsed ? officialSourceIdentity(parsed) : null;
		const jurisdictionCode = change.jurisdiction_code.toLocaleUpperCase();
		if (expectedJurisdictions.size > 0 && !expectedJurisdictions.has(jurisdictionCode)) {
			throw new Error(
				`Review item ${change.subject} names unconfigured jurisdiction ${jurisdictionCode}`
			);
		}
		if (
			!identity ||
			!officialUrls.has(identity) ||
			!sourceJurisdictionsByUrl.get(identity)?.has(jurisdictionCode)
		) {
			throw new Error(
				`Review item ${change.subject} does not cite a same-jurisdiction URL present in official_sources`
			);
		}
	}
	return report;
}

/**
 * Removes the model-owned duplicate-reference join from one already scoped jurisdiction result.
 *
 * The orchestration loop, not the model, owns the jurisdiction code. A review item's official URL
 * is itself evidence, so when the model omits that same URL from the separate source index we add a
 * source entry from the review fields before validation. HTTPS/allowlist validation still happens
 * afterwards; this only makes the redundant index complete and cannot admit an unofficial URL.
 */
export function completeJurisdictionProvenance(
	report: StatutoryResearchReport,
	jurisdictionCode: string
): StatutoryResearchReport {
	const code = jurisdictionCode.toLocaleUpperCase();
	const officialSources = report.official_sources.map((source) => ({
		...source,
		jurisdiction_code: code
	}));
	const changesToReview = report.changes_to_review.map((change) => ({
		...change,
		jurisdiction_code: code
	}));
	const indexedUrls = new Set(
		officialSources.flatMap((source) => {
			const parsed = officialUrl(source.url);
			return parsed ? [officialSourceIdentity(parsed)] : [];
		})
	);
	for (const change of changesToReview) {
		const parsed = officialUrl(change.source_url);
		if (!parsed) continue;
		const identity = officialSourceIdentity(parsed);
		if (indexedUrls.has(identity)) continue;
		officialSources.push({
			title: change.subject,
			url: change.source_url,
			jurisdiction_code: code,
			finding: change.latest_official_value
		});
		indexedUrls.add(identity);
	}
	return {
		...report,
		official_sources: officialSources,
		changes_to_review: changesToReview
	};
}

const clipped = (value: string, maximum: number): string =>
	value.length <= maximum ? value : `${value.slice(0, maximum - 12)}…[clipped]`;

/** Combines independently validated jurisdiction receipts without asking a model to merge them. */
export function aggregateResearchReceipts(
	receipts: ReadonlyArray<Readonly<{ code: string; report: StatutoryResearchReport }>>,
	localFindingCount: number
): StatutoryResearchReport {
	const codes = receipts.map(({ code }) => code.toLocaleUpperCase());
	const sources = new Map<string, StatutoryResearchReport['official_sources'][number]>();
	for (const { report } of receipts) {
		for (const source of report.official_sources) {
			const parsed = officialUrl(source.url);
			const identity = parsed ? officialSourceIdentity(parsed) : source.url;
			sources.set(`${source.jurisdiction_code.toLocaleUpperCase()}:${identity}`, source);
		}
	}
	const changes = receipts.flatMap(({ report }) => report.changes_to_review);
	const report: StatutoryResearchReport = {
		summary: clipped(
			`Official-source research completed independently for ${codes.join(', ')}. ${sources.size} source${sources.size === 1 ? '' : 's'} passed provenance validation; ${changes.length} potential change${changes.length === 1 ? '' : 's'} require authorised review. ${localFindingCount} local structural finding${localFindingCount === 1 ? '' : 's'} remain recorded separately in this receipt.`,
			1_200
		),
		highlights: receipts
			.slice(0, 8)
			.map(({ code, report: jurisdictionReport }) =>
				clipped(`${code.toLocaleUpperCase()}: ${jurisdictionReport.summary}`, 400)
			),
		official_sources: [...sources.values()],
		changes_to_review: changes
	};
	return validateResearchReceipt(report, codes);
}

/**
 * Executes one run. Exported so the behavioural test can exercise the authored handler with the
 * same capability boundary production receives rather than testing a second, simplified copy.
 */
export const runStatutoryProfileDrift = (api: AutomationApi) =>
	Effect.gen(function* () {
		const checkedAt = instantAt(yield* Clock.currentTimeMillis).toISOString();
		const today = todayKey();
		const asOf = todayInstant();
		let detectedItems: readonly DriftItem[] = [];
		let proposals: readonly string[] = [];

		yield* api.progress({ progress: 0.02, text: 'Opening statutory profile review' });
		const runLog = yield* api.db.statutory_profile_drift_logs.create({
			status: 'RUNNING',
			checked_at: checkedAt,
			local_findings_count: 0,
			local_findings: [],
			successor_proposals_count: 0,
			successor_proposals: []
		});

		const execution = Effect.gen(function* () {
			yield* api.progress({ progress: 0.12, text: 'Reading in-force statutory profiles' });
			const live = {
				approval_id: { isNull: true },
				effective_range: { contains_date: asOf }
			};
			const [inForceJurisdictions, inForceSchemes, inForceRates, companies, employments, facts] =
				yield* Effect.all(
					[
						api.db.query.jurisdictions.findMany({
							where: live,
							columns: {
								id: true,
								code: true,
								name: true,
								currency: true,
								tax_year_start_month: true,
								proration: true,
								ordinary_rate_basis: true,
								ordinary_rate_divisor: true,
								regime: true,
								effective_range: true
							},
							limit: 250
						}),
						api.db.query.statutory_contributions.findMany({
							where: live,
							columns: {
								id: true,
								jurisdiction_id: true,
								code: true,
								name: true,
								authority: true,
								payer: true,
								keyed_by: true,
								rounding: true,
								special_rules: true,
								overtime_treatments: true,
								overtime_excess_treatments: true,
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
								selector: true,
								award: true,
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

			yield* api.progress({ progress: 0.3, text: 'Comparing local effective-dated facts' });
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
			detectedItems = detected.items;
			yield* api.db.statutory_profile_drift_logs.update(runLog.id, {
				local_findings_count: detected.items.length,
				local_findings: detected.items
			});

			yield* api.progress({
				progress: 0.45,
				text: 'Submitting deterministic successor facts for HR review'
			});
			const submittedProposals: string[] = [];
			proposals = submittedProposals;
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
				yield* api.db.employment_statutory_facts.create({
					employment_id: copy.employmentId,
					statutory_contribution_id: copy.successorSchemeId,
					supersedes_fact_id: copy.factId,
					status,
					effective_range: { start: asOf, end: null }
				});
				submittedProposals.push(`${copy.label} · awaiting HR Manager approval`);
				existingSchemeIdsByEmployment.get(copy.employmentId)?.add(copy.successorSchemeId);
			}

			let report: StatutoryResearchReport;
			if (inForceJurisdictions.length === 0) {
				yield* api.progress({ progress: 0.62, text: 'Researching current official guidance' });
				const inferredReport = yield* api.infer({
					model: STATUTORY_RESEARCH_MODEL,
					schema: StatutoryResearchReportSchema,
					webSearch: { maxResults: 4, allowedDomains: OFFICIAL_STATUTORY_DOMAINS },
					prompt: [
						`Today is ${today}. No in-force statutory jurisdiction is configured.`,
						'Web research is still required: verify whether the workspace has enough statutory scope to assess, using only official sources.',
						'Do not invent a jurisdiction or a change. An empty official_sources list is valid when there is genuinely nothing configured to research.'
					].join('\n')
				});
				report = yield* Effect.try({
					try: () => validateResearchReceipt(inferredReport, []),
					catch: (error) => (error instanceof Error ? error : new Error(String(error)))
				});
			} else {
				const receipts: Array<Readonly<{ code: string; report: StatutoryResearchReport }>> = [];
				for (const [index, jurisdiction] of inForceJurisdictions.entries()) {
					const code = jurisdiction.code.toLocaleUpperCase();
					const progress = 0.62 + (index / inForceJurisdictions.length) * 0.24;
					yield* api.progress({
						progress,
						text: `Researching official guidance for ${code} (${index + 1}/${inForceJurisdictions.length})`
					});

					const jurisdictionSchemes = inForceSchemes.filter(
						(scheme) => scheme.jurisdiction_id === jurisdiction.id
					);
					const jurisdictionCompanies = companies
						.filter(
							(company) => asJurisdiction(company.company_jurisdiction)?.code === jurisdiction.code
						)
						.map((company) => company.name);
					const localSnapshot = {
						jurisdiction: {
							code,
							name: jurisdiction.name,
							currency: jurisdiction.currency,
							tax_year_start_month: jurisdiction.tax_year_start_month,
							proration: jurisdiction.proration,
							ordinary_rate_basis: jurisdiction.ordinary_rate_basis,
							ordinary_rate_divisor: jurisdiction.ordinary_rate_divisor,
							regime: jurisdiction.regime,
							effective_range: jurisdiction.effective_range
						},
						companies: jurisdictionCompanies,
						contributions: jurisdictionSchemes.map((scheme) => ({
							code: scheme.code,
							name: scheme.name,
							authority: scheme.authority,
							payer: scheme.payer,
							keyed_by: scheme.keyed_by,
							rounding: scheme.rounding,
							special_rules: scheme.special_rules,
							overtime_treatments: scheme.overtime_treatments,
							overtime_excess_treatments: scheme.overtime_excess_treatments,
							effective_range: scheme.effective_range,
							rates: inForceRates
								.filter((rate) => rate.statutory_contribution_id === scheme.id)
								.map((rate) => ({
									summary: rate.summary,
									selector: rate.selector,
									award: rate.award,
									effective_range: rate.effective_range
								}))
						}))
					};
					const prompt = [
						`Today is ${today}. Research ONLY the latest statutory payroll position for ${code} — ${jurisdiction.name}.`,
						'Actually use web search. Compare the complete local snapshot below with current official government, regulator, or statutory-body material.',
						`Every official_sources entry and every changes_to_review entry must use jurisdiction_code exactly "${code}".`,
						'Return at least one official source. Use only HTTPS URLs from the allowed official domains. Every review item must cite the exact official page it relies on in source_url.',
						'Do not use aggregators, law firms, search-result URLs, invented URLs, or sources for another jurisdiction.',
						'Do not claim that any change has been applied. The application never writes statutory configuration from this answer.',
						'Keep this jurisdiction receipt concise: at most 3 highlights, 4 official sources, and 4 review items.',
						`There are ${detected.items.length} local structural findings in the separate deterministic receipt. Do not enumerate employee rows or treat their count as web evidence.`,
						'Local statutory snapshot:',
						JSON.stringify(localSnapshot)
					].join('\n');
					const inferJurisdiction = (repair?: string) =>
						api.infer({
							model: STATUTORY_RESEARCH_MODEL,
							schema: JurisdictionResearchReportSchema,
							webSearch: { maxResults: 8, allowedDomains: OFFICIAL_STATUTORY_DOMAINS },
							prompt: repair
								? `${prompt}\nThe previous receipt failed validation: ${repair}\nResearch again and return a complete corrected receipt.`
								: prompt
						});
					const firstReport = yield* inferJurisdiction();
					const validated = yield* Effect.try({
						try: () =>
							validateResearchReceipt(completeJurisdictionProvenance(firstReport, code), [code]),
						catch: (error) => (error instanceof Error ? error : new Error(String(error)))
					}).pipe(
						Effect.catch((validationError) =>
							Effect.gen(function* () {
								yield* api.progress({
									progress: progress + 0.01,
									text: `Retrying official-source coverage for ${code}`
								});
								const repairedReport = yield* inferJurisdiction(errorMessage(validationError));
								return yield* Effect.try({
									try: () =>
										validateResearchReceipt(completeJurisdictionProvenance(repairedReport, code), [
											code
										]),
									catch: (error) => (error instanceof Error ? error : new Error(String(error)))
								});
							})
						)
					);
					receipts.push({ code, report: validated });
				}
				report = aggregateResearchReceipts(receipts, detected.items.length);
			}

			yield* api.progress({ progress: 0.9, text: 'Saving the statutory research receipt' });
			yield* api.db.statutory_profile_drift_logs.update(runLog.id, {
				status: 'SUCCEEDED',
				completed_at: instantAt(yield* Clock.currentTimeMillis).toISOString(),
				local_findings_count: detected.items.length,
				local_findings: detected.items,
				successor_proposals_count: submittedProposals.length,
				successor_proposals: submittedProposals,
				web_summary: report.summary,
				web_highlights: report.highlights,
				official_sources: report.official_sources,
				changes_to_review: report.changes_to_review,
				error: null
			});
			yield* api.progress({ progress: 1, text: 'Statutory profile review complete' });

			return {
				status: 'ok' as const,
				run_log_id: runLog.id,
				checked_on: today,
				items: detected.items.length,
				proposals: submittedProposals.length,
				summary: report.summary,
				highlights: report.highlights,
				official_sources: report.official_sources,
				changes_to_review: report.changes_to_review
			};
		});

		return yield* Effect.catch(execution, (error) =>
			Effect.gen(function* () {
				const message = errorMessage(error);
				yield* api.db.statutory_profile_drift_logs
					.update(runLog.id, {
						status: 'FAILED',
						completed_at: instantAt(yield* Clock.currentTimeMillis).toISOString(),
						local_findings_count: detectedItems.length,
						local_findings: detectedItems,
						successor_proposals_count: proposals.length,
						successor_proposals: proposals,
						error: message
					})
					.pipe(Effect.catch(() => Effect.void));
				yield* api
					.progress({ progress: 0.95, text: `Statutory profile review failed: ${message}` })
					.pipe(Effect.catch(() => Effect.void));
				return yield* Effect.fail(error);
			})
		);
	});

export default defineAutomation(
	{ schedule: '0 3 * * 1' },
	{
		input: StatutoryProfileDriftInputSchema,
		output: StatutoryProfileDriftOutputSchema,
		/**
		 * The authority every run of this automation acts under.
		 *
		 * Its own, not its trigger's. This used to inherit whoever tripped it — so the same nightly
		 * sweep ran as an administrator when an administrator happened to start it, and as a contractor
		 * otherwise, over a different set of rows each time. Naming it here is what makes "what can this
		 * automation touch" a question with an answer that does not depend on the day.
		 */
		policies: ['statutory_drift_automation'],
		description:
			'Weekly official-source review of every configured statutory payroll profile, directly submitting deterministic successor proposals for HR Manager approval.',
		handler: runStatutoryProfileDrift
	}
);
