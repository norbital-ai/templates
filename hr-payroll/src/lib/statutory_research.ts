import { refuse, type AutomationApi } from '@norbital-ai/bolt/authoring';
import { getErrorMessage } from '@norbital-ai/std';
import { sha256Text } from '@norbital-ai/std/reckon';
import { Cause, Clock, Effect, Exit, Schema } from 'effect';
import { contributionRuleSchema } from '../datatypes/contribution_rules/+definition.js';
import { codeListValueSchema } from '../datatypes/code_list/+definition.js';
import { factKeySchema, type FactKey } from '../datatypes/fact_keys/+definition.js';
import { leaveEntitlementValueSchema } from '../datatypes/leave_entitlement/+definition.js';
import { workRulesValueSchema, type WorkRules } from '../datatypes/work_rules/+definition.js';
import { stableJson } from './jurisdiction_settings.js';

/** One research URL that could not be read, with the page reader's reason. */
export const unreachableSourceSchema = Schema.Struct({
	url: Schema.NonEmptyString,
	reason: Schema.NonEmptyString,
	retrieved_at: Schema.String
});
type UnreachableSource = Schema.Schema.Type<typeof unreachableSourceSchema>;

/** One row the drift check found changed, and the page it stands on. */
export type StatutoryProposalChange = {
	readonly collection: 'jurisdiction_settings' | 'statutory_contributions' | 'leave_catalogue';
	readonly code: string;
	readonly field:
		| 'facts'
		| 'exit_facts'
		| 'proration'
		| 'proration_by'
		| 'ordinary_divisor_days'
		| 'encashment'
		| 'overtime_when'
		| 'normal_hours'
		| 'rate_week_hours'
		| 'bands'
		| 'limits'
		| 'breaks'
		| 'wages'
		| 'authority'
		| 'night_premium'
		| 'holiday_rest_precedence'
		| 'rules'
		| 'assessment_period'
		| 'assessment_scope'
		| 'elections'
		| 'employee_share_annual_cap'
		| 'shared_cap_group'
		| 'project_relief_annually'
		| 'assessed_on'
		| 'parts'
		| 'ordinary_on'
		| 'entitlement'
		| 'eligibility'
		| 'is_npl'
		| 'pay_fraction'
		| 'paid_by'
		| 'consumes_code'
		| 'unit'
		| 'can_encash'
		| 'encash_on_exit';
	readonly previous: unknown;
	readonly proposed: unknown;
	readonly source_url: string;
	readonly quote: string;
	readonly retrieved_at: string;
	readonly sha256: string;
	readonly effective_from: string;
};

/** The review sheet the drill automation keeps beside a proposed draft. */
export type StatutoryProposal = {
	readonly proposed_by: 'statutory_drift';
	readonly run_id: string;
	readonly proposed_at: string;
	readonly source_version_id: string;
	readonly changes: ReadonlyArray<StatutoryProposalChange>;
	readonly notes: ReadonlyArray<string>;
	readonly unreachable: ReadonlyArray<Schema.Schema.Type<typeof unreachableSourceSchema>>;
};

/**
 * Statutory research: reading the official pages a settings version names, and comparing what
 * they state with the statutory rows the version sealed.
 *
 * Everything here is either pure or a bounded page read through the runtime's own reader. The
 * model browses official sources for one lineage, and the
 * answer is decoded to `StatutoryFindingsSchema`: the official rule table of each scheme, the
 * official entitlement of each leave, each with the page and quote it stands on. `diffStatutoryFindings` then decides what changed; the
 * model never does.
 */

/** Whitespace normalisation supports excerpt verification against exactly the fetched page. */
const statutoryPageText = (html: string): string =>
	html
		.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;|&#160;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#(?:39|x27);/gi, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\s+/g, ' ')
		.trim();

type ResearchPage = Readonly<{
	url: string;
	requested_url: string;
	text: string;
	links: readonly string[];
	sha256: string;
	retrieved_at: string;
}>;

/**
 * The origins research may open: those of the version's own research URLs. HR vouched for those
 * sites by listing them; a link from one of them to another origin is not followed.
 */
export const officialUrlFor = (researchUrls: readonly string[]) => {
	const origins = new Set(
		researchUrls.flatMap((url) => (URL.canParse(url) ? [new URL(url).origin] : []))
	);
	return (value: string): URL | null => {
		if (!URL.canParse(value)) return null;
		const url = new URL(value);
		if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
		return origins.has(url.origin) ? url : null;
	};
};

type PageReader = Pick<AutomationApi, 'readUrl'>;

/** One official page, fetched through the host reader and reduced to what research verifies against. */
const fetchStatutoryPage = (
	api: PageReader,
	url: string,
	officialUrl: (url: string) => URL | null,
	retrievedAt: string
): Effect.Effect<ResearchPage> =>
	Effect.gen(function* () {
		if (officialUrl(url) == null)
			refuse('Statutory research opens only HTTPS pages on the origins the version names.');
		const page = yield* api.readUrl(url);
		if (officialUrl(page.url) == null)
			refuse('Official source redirected outside the origins the version names.');
		const content = page.body.replace(/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
		const text = statutoryPageText(content);
		if (/^(?:checking your browser|just a moment|verify you are human)\b/i.test(text))
			refuse(
				`Official page ${page.url} returned a browser challenge instead of statutory material.`
			);
		if (text.length < 40)
			refuse(`Official page ${page.url} contains no readable statutory material.`);
		if (text.length > 80_000)
			refuse(
				`Official page ${page.url} exceeds the research text limit; name a focused official document.`
			);
		const links = [
			...new Set(
				[...content.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].flatMap((match) => {
					const href = match[1].replaceAll('&amp;', '&');
					if (!URL.canParse(href, page.url)) return [];
					const link = new URL(href, page.url);
					if (link.protocol !== 'https:' || link.username || link.password || link.port) return [];
					link.hash = '';
					return [link.href];
				})
			)
		];
		return {
			url: page.url,
			requested_url: url,
			text,
			links,
			sha256: page.sha256 ?? sha256Text(page.body),
			retrieved_at: retrievedAt
		};
	});

/**
 * The sentence a failed page read is recorded with: the reader's own message (DNS, connect,
 * HTTP status, byte limit, timeout) or this module's refusal, never nameless.
 */
const unreachableReason = (cause: Cause.Cause<unknown>): string => {
	const message = getErrorMessage(Cause.squash(cause)).replace(/\s+/g, ' ').trim();
	const reason = message.length > 0 ? message.slice(0, 600) : 'The page reader gave no reason.';
	return /[.!?]$/.test(reason) ? reason : `${reason}.`;
};

/** One sentence for a run's history: how many sources answered, and which did not and why. */
export const describeSourcesRead = (
	named: number,
	unreachable: ReadonlyArray<UnreachableSource>,
	readCount = Math.max(0, named - unreachable.length)
): string => {
	const read = `${readCount} of ${named} sources read`;
	if (unreachable.length === 0) return `${read}.`;
	return `${read}; unreachable: ${unreachable
		.map((source) => `${source.url} (${source.reason})`)
		.join('; ')}`;
};

/**
 * Read the pages a lineage's research stands on, for quote verification.
 *
 * Research itself browses with the host browser; the automation then reads the version's own
 * research URLs and every page the model cited through `api.readUrl`, so a quote is checked
 * against the page as this host reads it. A URL that cannot be read is recorded with its reason
 * and its findings become notes rather than changes, never a silent proposal.
 */
export const verifyStatutorySources = (
	api: PageReader,
	urls: readonly string[],
	officialUrl: (url: string) => URL | null
): Effect.Effect<Readonly<{ pages: ResearchPage[]; unreachable: UnreachableSource[] }>> =>
	Effect.gen(function* () {
		const pages: ResearchPage[] = [];
		const unreachable: UnreachableSource[] = [];
		for (const url of new Set(urls)) {
			const retrievedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
			const exit = yield* Effect.exit(fetchStatutoryPage(api, url, officialUrl, retrievedAt));
			if (Exit.isFailure(exit)) {
				unreachable.push({
					url,
					reason: unreachableReason(exit.cause),
					retrieved_at: retrievedAt
				});
				continue;
			}
			pages.push(exit.value);
		}
		return { pages, unreachable };
	});

const evidence = {
	/** The exact URL of a page that was given or opened. */
	source_url: Schema.NonEmptyString,
	/** A short passage copied exactly from that page, which the automation verifies. */
	quote: Schema.NonEmptyString,
	/** The instrument's commencement date, not the research or publication date. Null if unknown. */
	effective_from: Schema.NullOr(Schema.String)
} as const;

const declarationFindingSchema = Schema.Struct({
	key: Schema.NonEmptyString,
	proposed: factKeySchema,
	...evidence
});

const contributionConfigurationValueSchema = Schema.Struct({
	assessment_period: Schema.Literals(['PAY_PERIOD', 'MONTH']),
	assessment_scope: Schema.Literals(['EMPLOYMENT', 'COMPANY']),
	employee_share_annual_cap: Schema.NullOr(Schema.Int),
	shared_cap_group: Schema.NullOr(Schema.String),
	project_relief_annually: Schema.Boolean,
	assessed_on: Schema.String,
	parts: codeListValueSchema,
	ordinary_on: Schema.String
});
type ContributionConfiguration = Schema.Schema.Type<typeof contributionConfigurationValueSchema>;

const leaveConfigurationValueSchema = Schema.Struct({
	eligibility: Schema.String,
	is_npl: Schema.Boolean,
	pay_fraction: Schema.String,
	paid_by: Schema.Literals(['EMPLOYER', 'FUND']),
	consumes_code: Schema.NullOr(Schema.String),
	unit: Schema.Literals(['DAY', 'HOUR']),
	can_encash: Schema.Boolean,
	encash_on_exit: Schema.Boolean
});
type LeaveConfiguration = Schema.Schema.Type<typeof leaveConfigurationValueSchema>;

const instrumentFindingSchema = Schema.Struct({
	title: Schema.NonEmptyString,
	issued_on: Schema.NullOr(Schema.String),
	/** What the instrument changes for this version: a scheme, a leave, a work rule or an obligation. */
	affects: Schema.String.check(Schema.isMaxLength(400)),
	status: Schema.Literals(['REFLECTED', 'PROPOSED', 'REVIEW', 'NOT_APPLICABLE']),
	...evidence
});

export { contributionRuleSchema };

/**
 * The discovery pass's answer: the official instruments issued, amended or announced since the
 * version commenced, before any row is compared. A smaller turn than the comparison, so the
 * research reads the issuance listings first and the comparison opens what they revealed.
 */
export const StatutoryDiscoverySchema = Schema.Struct({
	instruments: Schema.optionalKey(Schema.Array(instrumentFindingSchema)),
	notes: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isMaxLength(600))))
});

/**
 * What the model returns per lineage: the official position of each statutory row it found
 * evidence for, in the row's own shape. A row with no evidence on the pages is omitted, never
 * guessed. A scheme names only the rules that differ from the sealed row, never the whole table.
 */
export const StatutoryFindingsSchema = Schema.Struct({
	jurisdiction_settings: Schema.optionalKey(
		Schema.Struct({
			facts: Schema.optionalKey(Schema.Array(declarationFindingSchema)),
			exit_facts: Schema.optionalKey(Schema.Array(declarationFindingSchema)),
			work_rules: Schema.optionalKey(
				Schema.Struct({
					proration: Schema.optionalKey(
						Schema.Struct({ proposed: workRulesValueSchema.fields.proration, ...evidence })
					),
					proration_by: Schema.optionalKey(
						Schema.Struct({ proposed: workRulesValueSchema.fields.proration_by, ...evidence })
					),
					ordinary_divisor_days: Schema.optionalKey(
						Schema.Struct({
							proposed: workRulesValueSchema.fields.ordinary_divisor_days,
							...evidence
						})
					),
					ordinary_rate_reference: Schema.optionalKey(
						Schema.Struct({
							proposed: workRulesValueSchema.fields.ordinary_rate_reference,
							...evidence
						})
					),
					encashment: Schema.optionalKey(
						Schema.Struct({ proposed: workRulesValueSchema.fields.encashment, ...evidence })
					),
					overtime_when: Schema.optionalKey(
						Schema.Struct({ proposed: workRulesValueSchema.fields.overtime_when, ...evidence })
					),
					normal_hours: Schema.optionalKey(
						Schema.Struct({ proposed: workRulesValueSchema.fields.normal_hours, ...evidence })
					),
					rate_week_hours: Schema.optionalKey(
						Schema.Struct({ proposed: workRulesValueSchema.fields.rate_week_hours, ...evidence })
					),
					bands: Schema.optionalKey(
						Schema.Struct({ proposed: workRulesValueSchema.fields.bands, ...evidence })
					),
					limits: Schema.optionalKey(
						Schema.Struct({ proposed: workRulesValueSchema.fields.limits, ...evidence })
					),
					breaks: Schema.optionalKey(
						Schema.Struct({ proposed: workRulesValueSchema.fields.breaks, ...evidence })
					),
					wages: Schema.optionalKey(
						Schema.Struct({ proposed: workRulesValueSchema.fields.wages, ...evidence })
					),
					authority: Schema.optionalKey(
						Schema.Struct({ proposed: workRulesValueSchema.fields.authority, ...evidence })
					),
					night_premium: Schema.optionalKey(
						Schema.Struct({ proposed: workRulesValueSchema.fields.night_premium, ...evidence })
					),
					holiday_rest_precedence: Schema.optionalKey(
						Schema.Struct({
							proposed: workRulesValueSchema.fields.holiday_rest_precedence,
							...evidence
						})
					)
				})
			)
		})
	),
	contributions: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				code: Schema.NonEmptyString,
				rules: Schema.Array(contributionRuleSchema),
				...evidence
			})
		)
	),
	contribution_configuration: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				code: Schema.NonEmptyString,
				assessment_period: Schema.optionalKey(
					Schema.Struct({
						proposed: contributionConfigurationValueSchema.fields.assessment_period,
						...evidence
					})
				),
				assessment_scope: Schema.optionalKey(
					Schema.Struct({
						proposed: contributionConfigurationValueSchema.fields.assessment_scope,
						...evidence
					})
				),
				elections: Schema.optionalKey(Schema.Array(declarationFindingSchema)),
				employee_share_annual_cap: Schema.optionalKey(
					Schema.Struct({
						proposed: contributionConfigurationValueSchema.fields.employee_share_annual_cap,
						...evidence
					})
				),
				shared_cap_group: Schema.optionalKey(
					Schema.Struct({
						proposed: contributionConfigurationValueSchema.fields.shared_cap_group,
						...evidence
					})
				),
				project_relief_annually: Schema.optionalKey(
					Schema.Struct({
						proposed: contributionConfigurationValueSchema.fields.project_relief_annually,
						...evidence
					})
				),
				assessed_on: Schema.optionalKey(
					Schema.Struct({
						proposed: contributionConfigurationValueSchema.fields.assessed_on,
						...evidence
					})
				),
				parts: Schema.optionalKey(
					Schema.Struct({
						proposed: contributionConfigurationValueSchema.fields.parts,
						...evidence
					})
				),
				ordinary_on: Schema.optionalKey(
					Schema.Struct({
						proposed: contributionConfigurationValueSchema.fields.ordinary_on,
						...evidence
					})
				)
			})
		)
	),
	leave_catalogue: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				code: Schema.NonEmptyString,
				entitlement: leaveEntitlementValueSchema,
				...evidence
			})
		)
	),
	leave_configuration: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				code: Schema.NonEmptyString,
				eligibility: Schema.optionalKey(
					Schema.Struct({ proposed: leaveConfigurationValueSchema.fields.eligibility, ...evidence })
				),
				is_npl: Schema.optionalKey(
					Schema.Struct({ proposed: leaveConfigurationValueSchema.fields.is_npl, ...evidence })
				),
				pay_fraction: Schema.optionalKey(
					Schema.Struct({
						proposed: leaveConfigurationValueSchema.fields.pay_fraction,
						...evidence
					})
				),
				paid_by: Schema.optionalKey(
					Schema.Struct({ proposed: leaveConfigurationValueSchema.fields.paid_by, ...evidence })
				),
				consumes_code: Schema.optionalKey(
					Schema.Struct({
						proposed: leaveConfigurationValueSchema.fields.consumes_code,
						...evidence
					})
				),
				unit: Schema.optionalKey(
					Schema.Struct({ proposed: leaveConfigurationValueSchema.fields.unit, ...evidence })
				),
				can_encash: Schema.optionalKey(
					Schema.Struct({ proposed: leaveConfigurationValueSchema.fields.can_encash, ...evidence })
				),
				encash_on_exit: Schema.optionalKey(
					Schema.Struct({
						proposed: leaveConfigurationValueSchema.fields.encash_on_exit,
						...evidence
					})
				)
			})
		)
	),
	/**
	 * Every official instrument the research found issued, amended or announced since the version's
	 * commencement (a regulation, circular, wage order, rate table, gazette notice), with what it
	 * does to this version: already reflected in the sealed rows, carried by a proposed change, or
	 * needing human review (an obligation, a rule the proposal cannot express, an unsettled date).
	 */
	instruments: Schema.optionalKey(Schema.Array(instrumentFindingSchema)),
	/** Observations that are not a row: a notice of a future change, a page that had no table. */
	notes: Schema.optionalKey(Schema.Array(Schema.String.check(Schema.isMaxLength(600))))
});
type StatutoryFindings = Schema.Schema.Type<typeof StatutoryFindingsSchema>;

/** The statutory rows a sealed version states, as the diff and the prompt read them. */
export type SealedStatutoryFacts = Readonly<{
	work_rules: WorkRules;
	facts: ReadonlyArray<FactKey>;
	exit_facts: ReadonlyArray<FactKey>;
	contributions: ReadonlyArray<
		Readonly<{
			code: string;
			name: string;
			authority: string | null;
			rules: ReadonlyArray<Schema.Schema.Type<typeof contributionRuleSchema>>;
			configuration: ContributionConfiguration;
			elections: ReadonlyArray<FactKey>;
		}>
	>;
	leave_catalogue: ReadonlyArray<
		Readonly<{
			code: string;
			name: string;
			authority: string | null;
			entitlement: unknown;
			configuration: LeaveConfiguration;
		}>
	>; /** Compared by the model and reported for review; never proposed as a change. */
	effective_from?: string | null;
	obligations?: unknown;
	payroll?: unknown;
}>;

/** The condition a rule governs under is its identity; the money it awards is the change. */
export const ruleKey = (rule: Schema.Schema.Type<typeof contributionRuleSchema>): string =>
	stableJson(rule.when);

type StatutoryDiff = Readonly<{
	changes: ReadonlyArray<StatutoryProposalChange>;
	notes: ReadonlyArray<string>;
	requires_review: boolean;
}>;

/**
 * What differs between the sealed rows and the official findings, each difference standing on a
 * quote that appears in a page that was actually retrieved. A finding for a code the version
 * does not seal, or one whose quote is not on its page, is a note, never a change.
 */
export function diffStatutoryFindings(
	sealed: SealedStatutoryFacts,
	findings: StatutoryFindings,
	pages: readonly ResearchPage[]
): StatutoryDiff {
	const changes: StatutoryProposalChange[] = [];
	const notes: string[] = [];
	const reviewed = new Set<string>();
	const verified = (
		finding: Readonly<{
			code: string;
			source_url: string;
			quote: string;
			effective_from?: string | null;
		}>,
		what: string
	): ResearchPage | null => {
		const page = pages.find(
			(row) => row.url === finding.source_url || row.requested_url === finding.source_url
		);
		const quote = statutoryPageText(finding.quote);
		if (page == null) {
			notes.push(`${what} ${finding.code}: cites ${finding.source_url}, which was not retrieved`);
			return null;
		}
		// Whitespace is layout, not wording: a statute page renders `第 2 條` across line elements that
		// a browser reads as `第2條`, so the passage is compared with every space removed.
		// NFKC too: a page's full-width comma or digit and the quote's half-width one are one text.
		const compact = (text: string) => text.normalize('NFKC').replace(/\s+/g, '');
		if (quote.length < 20 || !compact(page.text).includes(compact(quote))) {
			notes.push(
				`${what} ${finding.code}: the quote does not appear on ${page.url} ("${finding.quote.slice(0, 160)}")`
			);
			return null;
		}
		return page;
	};
	const change = (
		collection: StatutoryProposalChange['collection'],
		field: StatutoryProposalChange['field'],
		finding: Readonly<{ code: string; source_url: string; quote: string }>,
		page: ResearchPage,
		previous: unknown,
		proposed: unknown,
		effectiveFrom: string
	): StatutoryProposalChange => ({
		collection,
		code: finding.code,
		field,
		previous,
		proposed,
		source_url: page.url,
		quote: statutoryPageText(finding.quote),
		retrieved_at: page.retrieved_at,
		sha256: page.sha256,
		effective_from: effectiveFrom
	});
	const effectiveDate = (finding: {
		code: string;
		effective_from?: string | null;
	}): string | null => {
		const day = finding.effective_from;
		const parsed = day == null ? NaN : Date.parse(`${day}T00:00:00.000Z`);
		if (
			day == null ||
			!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
			!Number.isFinite(parsed) ||
			new Date(parsed).toISOString().slice(0, 10) !== day
		) {
			notes.push(
				`${finding.code}: the statutory effective date is missing or invalid; review required`
			);
			return null;
		}
		return day;
	};
	for (const finding of findings.contributions ?? []) {
		const scheme = sealed.contributions.find((row) => row.code === finding.code);
		if (scheme == null) {
			notes.push(`Scheme ${finding.code}: not a statutory scheme of this version`);
			continue;
		}
		// A finding names only the rules that differ from the sealed row. Each is matched to the
		// sealed rule with the same selector. New conditions require review of the full table;
		// appending them could leave an earlier rule matching the same wages. Unchanged rules
		// produce no proposal. This is what keeps a four-thousand-rule table out of the model's answer.
		const page = verified(finding, 'Scheme');
		if (page == null) continue;
		reviewed.add(`Scheme ${finding.code}`);
		for (const rule of finding.rules) {
			const key = ruleKey(rule);
			const prior = scheme.rules.find((row) => ruleKey(row) === key);
			if (prior === undefined) {
				notes.push(
					`Scheme ${finding.code}: a new or changed rule condition requires manual review of the complete table`
				);
				continue;
			}
			// Omitted optional fields retain the sealed value; an explicit 0.0 removes a rebate.
			const proposed = { ...prior, ...rule };
			if (
				stableJson([
					prior.employee,
					prior.employer,
					prior.rebate ?? '0.0',
					prior.deduction ?? '0.0',
					prior.refusal ?? '',
					prior.warning ?? ''
				]) ===
				stableJson([
					proposed.employee,
					proposed.employer,
					proposed.rebate ?? '0.0',
					proposed.deduction ?? '0.0',
					proposed.refusal ?? '',
					proposed.warning ?? ''
				])
			)
				continue;
			const effectiveFrom = effectiveDate(finding);
			if (effectiveFrom == null) continue;
			changes.push(
				change(
					'statutory_contributions',
					'rules',
					finding,
					page,
					[prior],
					[proposed],
					effectiveFrom
				)
			);
		}
	}
	for (const finding of findings.leave_catalogue ?? []) {
		const type = sealed.leave_catalogue.find((row) => row.code === finding.code);
		if (type == null) {
			notes.push(`Leave ${finding.code}: not a statutory leave of this version`);
			continue;
		}
		const page = verified(finding, 'Leave');
		if (page == null) continue;
		reviewed.add(`Leave ${finding.code}`);
		if (stableJson(type.entitlement) === stableJson(finding.entitlement)) continue;
		const effectiveFrom = effectiveDate(finding);
		if (effectiveFrom == null) continue;
		changes.push(
			change(
				'leave_catalogue',
				'entitlement',
				finding,
				page,
				type.entitlement,
				finding.entitlement,
				effectiveFrom
			)
		);
	}
	/** The value without its `authority` citations: a restatement that omits one changes nothing. */
	const unannotated = (value: unknown): unknown =>
		Array.isArray(value)
			? value.map(unannotated)
			: value != null && typeof value === 'object'
				? Object.fromEntries(
						Object.entries(value)
							.filter(([key]) => key !== 'authority')
							.map(([key, item]) => [key, unannotated(item)])
					)
				: value;
	const compareConfiguration = (
		collection: StatutoryProposalChange['collection'],
		code: string,
		field: StatutoryProposalChange['field'],
		previous: unknown,
		finding: Readonly<{
			proposed: unknown;
			source_url: string;
			quote: string;
			effective_from?: string | null;
		}>,
		what: string
	) => {
		const supported = { code, ...finding };
		const page = verified(supported, what);
		if (
			page == null ||
			stableJson(unannotated(previous)) === stableJson(unannotated(finding.proposed))
		)
			return false;
		const effectiveFrom = effectiveDate(supported);
		if (effectiveFrom == null) return false;
		changes.push(
			change(collection, field, supported, page, previous, finding.proposed, effectiveFrom)
		);
		return true;
	};
	const compareDeclaration = (
		collection: StatutoryProposalChange['collection'],
		field: 'facts' | 'exit_facts' | 'elections',
		code: string,
		stored: readonly FactKey[],
		finding: Schema.Schema.Type<typeof declarationFindingSchema>,
		what: string
	) => {
		if (finding.proposed.key !== finding.key) {
			notes.push(
				`${what} ${finding.key}: the proposed declaration changes its key; review required`
			);
			return;
		}
		const previous = stored.find((row) => row.key === finding.key);
		if (previous == null) {
			notes.push(`${what} ${finding.key}: a new declaration requires workflow review`);
			return;
		}
		compareConfiguration(collection, code, field, previous, finding, what);
	};
	for (const field of ['facts', 'exit_facts'] as const)
		for (const finding of findings.jurisdiction_settings?.[field] ?? [])
			compareDeclaration(
				'jurisdiction_settings',
				field,
				finding.key,
				sealed[field],
				finding,
				`Settings ${field}`
			);
	for (const [field, finding] of Object.entries(findings.jurisdiction_settings?.work_rules ?? {})) {
		if (finding == null || typeof finding !== 'object' || !('proposed' in finding)) continue;
		compareConfiguration(
			'jurisdiction_settings',
			'settings',
			field as StatutoryProposalChange['field'],
			(sealed.work_rules as unknown as Readonly<Record<string, unknown>>)[field],
			finding as Readonly<{
				proposed: unknown;
				source_url: string;
				quote: string;
				effective_from?: string | null;
			}>,
			'Work rule'
		);
	}
	for (const finding of findings.contribution_configuration ?? []) {
		const scheme = sealed.contributions.find((row) => row.code === finding.code);
		if (scheme == null) {
			notes.push(`Scheme ${finding.code}: not a statutory scheme of this version`);
			continue;
		}
		for (const [field, value] of Object.entries(finding)) {
			if (field === 'code' || field === 'elections' || value == null) continue;
			if (typeof value !== 'object' || !('proposed' in value)) continue;
			const compared = compareConfiguration(
				'statutory_contributions',
				finding.code,
				field as StatutoryProposalChange['field'],
				scheme.configuration[field as keyof ContributionConfiguration],
				value,
				'Scheme configuration'
			);
			if (compared) reviewed.add(`Scheme ${finding.code}`);
		}
		for (const declaration of finding.elections ?? []) {
			compareDeclaration(
				'statutory_contributions',
				'elections',
				finding.code,
				scheme.elections,
				declaration,
				`Scheme ${finding.code} election`
			);
			reviewed.add(`Scheme ${finding.code}`);
		}
	}
	for (const finding of findings.leave_configuration ?? []) {
		const type = sealed.leave_catalogue.find((row) => row.code === finding.code);
		if (type == null) {
			notes.push(`Leave ${finding.code}: not a statutory leave of this version`);
			continue;
		}
		for (const [field, value] of Object.entries(finding)) {
			if (field === 'code' || value == null) continue;
			if (typeof value !== 'object' || !('proposed' in value)) continue;
			const compared = compareConfiguration(
				'leave_catalogue',
				finding.code,
				field as StatutoryProposalChange['field'],
				type.configuration[field as keyof LeaveConfiguration],
				value,
				'Leave configuration'
			);
			if (compared) reviewed.add(`Leave ${finding.code}`);
		}
	}
	if (findings.instruments == null)
		notes.push(
			'The research listed no instruments, so no discovery pass stands behind it; review required'
		);
	for (const instrument of findings.instruments ?? []) {
		const page = verified({ ...instrument, code: instrument.title }, 'Instrument');
		if (page != null && instrument.status === 'REVIEW')
			notes.push(
				`Instrument ${instrument.title} (${instrument.effective_from ?? 'commencement unknown'}): ${instrument.affects} Review required.`
			);
	}
	for (const label of [
		...sealed.contributions.map((row) => `Scheme ${row.code}`),
		...sealed.leave_catalogue.map((row) => `Leave ${row.code}`)
	])
		if (!reviewed.has(label)) notes.push(`${label}: no verified comparison; review required`);
	return {
		changes,
		requires_review: notes.length > 0 || (findings.notes ?? []).length > 0 || reviewed.size === 0,
		notes: [...notes, ...(findings.notes ?? [])]
	};
}
