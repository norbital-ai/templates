import { type AutomationApi, captureApproval, refuse } from '@norbital-ai/bolt/authoring';
import { sha256Json, sha256Text } from '@norbital-ai/std/reckon';
import { Clock, Effect, Schema } from 'effect';
import { prorationBasisValueSchema } from '../datatypes/proration_basis/+definition.js';
import { statutoryRegimeValueSchema } from '../datatypes/statutory_regime/+definition.js';
import { statutoryLeaveProfileValueSchema } from '../datatypes/statutory_leave_profile/+definition.js';
import { statutoryContributionRevisionSchema } from '../datatypes/statutory_revision/+definition.js';
import { PAYROLL_TIME_ZONE, startOfDayInstant } from './ui/calendar.js';

const isProposalRecord = Schema.is(Schema.Record(Schema.String, Schema.Unknown));

const DEFAULT_SOURCES: Readonly<Record<string, readonly string[]>> = {
	SG: [
		'https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay',
		'https://www.mom.gov.sg/employment-practices/leave',
		'https://www.mom.gov.sg/employment-practices/leave/shared-parental-leave'
	],
	MY: ['https://www.kwsp.gov.my/employer'],
	ID: ['https://www.pajak.go.id/id/peraturan'],
	PH: ['https://www.pagibigfund.gov.ph/Membership_Contributions.html'],
	TW: ['https://www.bli.gov.tw/en/'],
	VN: ['https://baohiemxahoi.gov.vn/']
};

export const StatutoryLawProposalSchema = Schema.Struct({
	effective_from: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
	evidence: Schema.Array(
		Schema.Struct({
			source_url: Schema.NonEmptyString,
			title: Schema.NonEmptyString,
			quote: Schema.NonEmptyString
		})
	).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
	changes: Schema.Struct({
		proration: Schema.optional(prorationBasisValueSchema),
		ordinary_rate_basis: Schema.optional(Schema.Literals(['DAYS_PER_MONTH', 'HOURS_PER_MONTH'])),
		ordinary_rate_divisor: Schema.optional(Schema.Finite.check(Schema.isGreaterThan(0))),
		regime: Schema.optional(statutoryRegimeValueSchema),
		statutory_leave: Schema.optional(statutoryLeaveProfileValueSchema),
		contributions: Schema.optional(Schema.Array(statutoryContributionRevisionSchema))
	})
});

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

export const fetchStatutoryPages = (
	api: AutomationApi,
	profile: { code: string; research_urls?: readonly string[] | null },
	officialUrl: (url: string) => URL | null
) =>
	Effect.gen(function* () {
		const urls = [
			...new Set(
				profile.research_urls?.length
					? profile.research_urls
					: (DEFAULT_SOURCES[profile.code] ?? [])
			)
		];
		if (urls.length === 0 || urls.length > 8)
			refuse(`Configure between one and eight official research URLs for ${profile.code}.`);
		const retrievedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
		return yield* Effect.forEach(
			urls,
			(url) =>
				Effect.gen(function* () {
					if (officialUrl(url) == null)
						refuse('Statutory research URL must be an allowed official HTTPS page.');
					const page = yield* api.readUrl(url);
					if (officialUrl(page.url) == null)
						refuse('Official source redirected outside the permitted statutory domains.');
					const text = statutoryPageText(page.body);
					if (text.length < 40)
						refuse(`Official page ${page.url} contains no readable statutory material.`);
					return {
						url: page.url,
						requested_url: url,
						text: text.slice(0, 80_000),
						sha256: sha256Text(page.body),
						retrieved_at: retrievedAt
					};
				}),
			{ concurrency: 2 }
		);
	});

/** The automation proposes a sealed successor; its policy requires HR approval before it governs. */
export const proposeStatutoryLaw = (
	api: AutomationApi,
	profileId: string,
	proposal: typeof StatutoryLawProposalSchema.Type,
	pages: readonly {
		url: string;
		requested_url: string;
		text: string;
		sha256: string;
		retrieved_at: string;
	}[]
) =>
	Effect.gen(function* () {
		const sources = proposal.evidence.map((evidence) => {
			const page = pages.find(
				(row) => row.url === evidence.source_url || row.requested_url === evidence.source_url
			);
			const quote = statutoryPageText(evidence.quote);
			if (page == null || quote.length < 20 || !page.text.includes(quote))
				refuse('A statutory proposal must quote the fetched official page exactly.');
			return {
				url: page.url,
				title: evidence.title,
				retrieved_at: page.retrieved_at,
				sha256: page.sha256,
				excerpt: quote
			};
		});
		const previous = yield* api.db.jurisdictions.findFirst({
			where: { id: { eq: profileId }, approval_id: { isNull: true } }
		});
		if (previous == null || previous.lifecycle !== 'SEALED')
			refuse('The statutory baseline is no longer an approved sealed profile.');
		const pending = yield* api.db.approval_request.findMany({
			where: { collection_name: { eq: 'jurisdictions' }, status: { eq: 'ONGOING' } },
			columns: { proposed_values: true },
			limit: 1_000
		});
		if (pending.length >= 1_000)
			refuse('Too many pending statutory reviews to verify revision uniqueness.');
		if (
			pending.some(
				(row) =>
					isProposalRecord(row.proposed_values) && row.proposed_values.supersedes_id === previous.id
			)
		)
			return null;
		const { contributions, ...law } = proposal.changes;
		const changed = Object.entries(law).some(
			([key, value]) => sha256Json(value) !== sha256Json(previous[key as keyof typeof previous])
		);
		if (!changed && (contributions == null || contributions.length === 0)) return null;
		const duplicate = yield* api.db.jurisdictions.findFirst({
			where: { supersedes_id: { eq: previous.id } },
			columns: { id: true }
		});
		if (duplicate != null) return null;
		const revised = new Map(
			(previous.revision?.contributions ?? []).map((row) => [row.statutory_contribution_id, row])
		);
		for (const contribution of contributions ?? [])
			revised.set(contribution.statutory_contribution_id, contribution);
		yield* captureApproval(
			api.db.jurisdictions.mutate([
				{
					code: previous.code,
					name: previous.name,
					currency: previous.currency,
					tax_year_start_month: previous.tax_year_start_month,
					proration: previous.proration,
					ordinary_rate_basis: previous.ordinary_rate_basis,
					ordinary_rate_divisor: previous.ordinary_rate_divisor,
					regime: previous.regime,
					statutory_leave: previous.statutory_leave,
					research_urls: previous.research_urls,
					...law,
					lifecycle: 'SEALED',
					supersedes_id: previous.id,
					effective_range: {
						start: startOfDayInstant(proposal.effective_from, PAYROLL_TIME_ZONE),
						end: null
					},
					revision: { sources, contributions: [...revised.values()] }
				}
			])
		);
		return `Statutory ${previous.code} revision from ${proposal.effective_from} submitted for HR Manager approval.`;
	});
