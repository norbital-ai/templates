import { refuse, type AutomationApi } from '@norbital-ai/bolt/authoring';
import { getErrorMessage } from '@norbital-ai/std';
import { sha256Text } from '@norbital-ai/std/reckon';
import { Cause, Clock, Effect, Exit, Schema } from 'effect';
import { contributionBandSchema as rateBandSchema } from '../datatypes/contribution_bands/+definition.js';
import { leaveEntitlementValueSchema } from '../datatypes/leave_entitlement/+definition.js';
import { statutoryOptInValueSchema } from '../datatypes/work_rules/+definition.js';
import { stableJson } from './jurisdiction_settings.js';

/** One research URL that could not be read, with the page reader's reason. */
export const unreachableSourceSchema = Schema.Struct({
	url: Schema.NonEmptyString,
	reason: Schema.NonEmptyString,
	retrieved_at: Schema.String
});
type UnreachableSource = Schema.Schema.Type<typeof unreachableSourceSchema>;

/** One row the drift check found changed, and the page it stands on. */
const statutoryProposalChangeSchema = Schema.Struct({
	collection: Schema.Literals(['statutory_contributions', 'leave_catalogue', 'pay_component']),
	code: Schema.NonEmptyString,
	field: Schema.Literals(['bands', 'entitlement', 'statutory_opt_ins']),
	previous: Schema.Unknown,
	proposed: Schema.Unknown,
	source_url: Schema.NonEmptyString,
	quote: Schema.NonEmptyString,
	retrieved_at: Schema.String,
	sha256: Schema.String
});
export type StatutoryProposalChange = Schema.Schema.Type<typeof statutoryProposalChangeSchema>;

/** The review sheet the drill automation keeps beside a proposed draft. */
const statutoryProposalValueSchema = Schema.Struct({
	proposed_by: Schema.Literal('statutory_drift'),
	run_id: Schema.String,
	proposed_at: Schema.String,
	source_version_id: Schema.String,
	changes: Schema.Array(statutoryProposalChangeSchema),
	notes: Schema.Array(Schema.String),
	unreachable: Schema.Array(unreachableSourceSchema)
});
export type StatutoryProposal = Schema.Schema.Type<typeof statutoryProposalValueSchema>;

/**
 * Statutory research: reading the official pages a settings version names, and comparing what
 * they state with the statutory rows the version sealed.
 *
 * Everything here is either pure or a bounded page read through the runtime's own reader. The
 * model is asked one question per lineage, with `read_official_page` as its only tool, and the
 * answer is decoded to `StatutoryFindingsSchema`: the official band table of each scheme, the
 * official entitlement of each leave, the official opt-ins of each component, each
 * with the page and quote it stands on. `diffStatutoryFindings` then decides what changed; the
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

export type ResearchPage = Readonly<{
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
	unreachable: ReadonlyArray<UnreachableSource>
): string => {
	const read = `${named - unreachable.length} of ${named} sources read`;
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
	quote: Schema.NonEmptyString
} as const;

export { rateBandSchema };

/**
 * What the model returns per lineage: the official position of each statutory row it found
 * evidence for, in the row's own shape. A row with no evidence on the pages is omitted, never
 * guessed. A scheme names only the bands that differ from the sealed row, never the whole table.
 */
export const StatutoryFindingsSchema = Schema.Struct({
	contributions: Schema.Array(
		Schema.Struct({ code: Schema.NonEmptyString, bands: Schema.Array(rateBandSchema), ...evidence })
	),
	leave_catalogue: Schema.Array(
		Schema.Struct({
			code: Schema.NonEmptyString,
			entitlement: leaveEntitlementValueSchema,
			...evidence
		})
	),
	pay_component: Schema.Array(
		Schema.Struct({
			code: Schema.NonEmptyString,
			statutory_opt_ins: Schema.Array(statutoryOptInValueSchema),
			...evidence
		})
	),
	/** Observations that are not a row: a notice of a future change, a page that had no table. */
	notes: Schema.Array(Schema.String.check(Schema.isMaxLength(600)))
});
type StatutoryFindings = Schema.Schema.Type<typeof StatutoryFindingsSchema>;

/** The statutory rows a sealed version states, as the diff and the prompt read them. */
export type SealedStatutoryFacts = Readonly<{
	contributions: ReadonlyArray<
		Readonly<{
			code: string;
			name: string;
			authority: string | null;
			bands: ReadonlyArray<Schema.Schema.Type<typeof rateBandSchema>>;
		}>
	>;
	leave_catalogue: ReadonlyArray<
		Readonly<{ code: string; name: string; authority: string | null; entitlement: unknown }>
	>;
	pay_component: ReadonlyArray<Readonly<{ code: string; statutory_opt_ins: unknown }>>;
}>;

/** The condition a band governs under is its identity; the money it awards is the change. */
export const bandKey = (band: Schema.Schema.Type<typeof rateBandSchema>): string =>
	stableJson(band.when);

type StatutoryDiff = Readonly<{
	changes: ReadonlyArray<StatutoryProposalChange>;
	notes: ReadonlyArray<string>;
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
	const verified = (
		finding: Readonly<{ code: string; source_url: string; quote: string }>,
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
		if (quote.length < 20 || !page.text.includes(quote)) {
			notes.push(`${what} ${finding.code}: the quote does not appear on ${page.url}`);
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
		proposed: unknown
	): StatutoryProposalChange => ({
		collection,
		code: finding.code,
		field,
		previous,
		proposed,
		source_url: page.url,
		quote: statutoryPageText(finding.quote),
		retrieved_at: page.retrieved_at,
		sha256: page.sha256
	});
	for (const finding of findings.contributions) {
		const scheme = sealed.contributions.find((row) => row.code === finding.code);
		if (scheme == null) {
			notes.push(`Scheme ${finding.code}: not a statutory scheme of this version`);
			continue;
		}
		if (finding.bands.length === 0) continue;
		// A finding names only the bands that differ from the sealed row. Each is matched to the
		// sealed band with the same selector: a changed award replaces it, a selector the sealed
		// table does not hold adds a band, and a band the pages restate unchanged is dropped rather
		// than proposed. This is what keeps a four-thousand-band table out of the model's answer.
		const page = verified(finding, 'Scheme');
		if (page == null) continue;
		for (const band of finding.bands) {
			const key = bandKey(band);
			const prior = scheme.bands.find((row) => bandKey(row) === key);
			if (
				prior !== undefined &&
				stableJson([prior.employee, prior.employer]) === stableJson([band.employee, band.employer])
			)
				continue;
			changes.push(
				change(
					'statutory_contributions',
					'bands',
					finding,
					page,
					prior === undefined ? [] : [prior],
					[band]
				)
			);
		}
	}
	for (const finding of findings.leave_catalogue) {
		const type = sealed.leave_catalogue.find((row) => row.code === finding.code);
		if (type == null) {
			notes.push(`Leave ${finding.code}: not a statutory leave of this version`);
			continue;
		}
		if (stableJson(type.entitlement) === stableJson(finding.entitlement)) continue;
		const page = verified(finding, 'Leave');
		if (page == null) continue;
		changes.push(
			change('leave_catalogue', 'entitlement', finding, page, type.entitlement, finding.entitlement)
		);
	}
	for (const finding of findings.pay_component) {
		const component = sealed.pay_component.find((row) => row.code === finding.code);
		if (component == null) {
			notes.push(`Component ${finding.code}: not a statutory component of this version`);
			continue;
		}
		if (stableJson(component.statutory_opt_ins) === stableJson(finding.statutory_opt_ins)) continue;
		const page = verified(finding, 'Component');
		if (page == null) continue;
		changes.push(
			change(
				'pay_component',
				'statutory_opt_ins',
				finding,
				page,
				component.statutory_opt_ins,
				finding.statutory_opt_ins
			)
		);
	}
	return { changes, notes: [...notes, ...findings.notes] };
}
