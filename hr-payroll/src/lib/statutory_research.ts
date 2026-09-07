import { refuse, type AutomationApi, type InferenceTool } from '@norbital-ai/bolt/authoring';
import { getErrorMessage } from '@norbital-ai/std';
import { sha256Text } from '@norbital-ai/std/reckon';
import { Cause, Clock, Effect, Exit, Schema } from 'effect';
import { rateSelectorValueSchema } from '../datatypes/rate_selector/+definition.js';
import { rateAwardValueSchema } from '../datatypes/rate_award/+definition.js';
import { leaveEntitlementValueSchema } from '../datatypes/leave_entitlement/+definition.js';
import { contributionTreatmentsValueSchema } from '../datatypes/contribution_treatments/+definition.js';
import type {
	StatutoryProposalChange,
	UnreachableSource
} from '../datatypes/statutory_proposal/+definition.js';
import { stableJson } from './jurisdiction_settings.js';

/**
 * Statutory research: reading the official pages a settings version names, and comparing what
 * they state with the statutory rows the version sealed.
 *
 * Everything here is either pure or a bounded page read through the runtime's own reader. The
 * model is asked one question per lineage, with `read_official_page` as its only tool, and the
 * answer is decoded to `StatutoryFindingsSchema`: the official band table of each scheme, the
 * official entitlement of each leave type, the official treatments of each pay component, each
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

/** Words that mark a sentence as statutory payroll material rather than navigation or news. */
const STATUTORY_CUES =
	/\b(contribution|contributions|rate|rates|ceiling|cap|wage|wages|salary|leave|entitle|entitlement|employer|employee|percent|per cent|effective|w\.e\.f|from 1|monthly|annual|deduct|levy|premium|insured|threshold|minimum|maximum|statutory|act|regulation|amend|allowance|overtime|holiday|maternity|paternity|parental|childcare|sick)\b|\d+(?:\.\d+)?\s?%|(?:S\$|RM|NT\$|Rp|₱|₫|\$)\s?\d/i;

/**
 * The part of a retrieved page worth a model's attention, inside a fixed budget. Official pages
 * are mostly navigation and news; sentences carrying statutory cues are kept in page order until
 * the budget is spent, and a page with no cued sentence keeps its head so the model still sees
 * what it is. Quote verification runs against the full page text, never this view.
 */
const focusStatutoryText = (text: string, budget: number): string => {
	if (text.length <= budget) return text;
	const sentences = text.split(/(?<=[.!?。])\s+|\s{2,}/).map((sentence) => sentence.trim());
	const kept: string[] = [];
	let used = 0;
	for (const sentence of sentences) {
		if (sentence.length === 0 || !STATUTORY_CUES.test(sentence)) continue;
		const clipped = sentence.length > 600 ? `${sentence.slice(0, 600)}...` : sentence;
		if (used + clipped.length + 1 > budget) break;
		kept.push(clipped);
		used += clipped.length + 1;
	}
	if (kept.length === 0) return `${text.slice(0, budget)}...`;
	return `${kept.join(' ')} [focused: ${kept.length} statutory sentences of a ${text.length}-character page]`;
};

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

/**
 * What the research prompt carries per page: focused text and only the links a page may open
 * (allowed origins, first `maxLinks`). The full page stays on the receipt for quote verification.
 */
export const researchPromptPages = (
	pages: readonly ResearchPage[],
	officialUrl: (url: string) => unknown,
	limits: Readonly<{ perPageChars: number; totalChars: number; maxLinks: number }> = {
		perPageChars: 12_000,
		totalChars: 36_000,
		maxLinks: 40
	}
): ReadonlyArray<Readonly<{ url: string; text: string; links: readonly string[] }>> => {
	const share = Math.max(2_000, Math.floor(limits.totalChars / Math.max(1, pages.length)));
	const budget = Math.min(limits.perPageChars, share);
	return pages.map((page) => ({
		url: page.url,
		text: focusStatutoryText(page.text, budget),
		links: page.links.filter((link) => officialUrl(link) != null).slice(0, limits.maxLinks)
	}));
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
		const text = statutoryPageText(page.body);
		if (text.length < 40)
			refuse(`Official page ${page.url} contains no readable statutory material.`);
		if (text.length > 80_000)
			refuse(
				`Official page ${page.url} exceeds the research text limit; name a focused official document.`
			);
		const links = [
			...new Set(
				[...page.body.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].flatMap((match) => {
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

/** Bounds of one lineage's research: entry URLs a version may name, and the pages read at once. */
const RESEARCH_FETCH_LIMITS = { maxEntryUrls: 32, concurrency: 2 } as const;

/**
 * The sentence a failed page read is recorded with: the reader's own message (DNS, connect,
 * HTTP status, byte limit, timeout) or this module's refusal, never nameless.
 */
const unreachableReason = (cause: Cause.Cause<unknown>): string => {
	const message = getErrorMessage(Cause.squash(cause)).replace(/\s+/g, ' ').trim();
	const reason = message.length > 0 ? message.slice(0, 600) : 'The page reader gave no reason.';
	return /[.!?]$/.test(reason) ? reason : `${reason}.`;
};

/** The entry pages that answered and, source by source, the ones that did not. */
type StatutoryPagesRead = Readonly<{
	pages: ResearchPage[];
	unreachable: ReadonlyArray<UnreachableSource>;
}>;

/**
 * The entry pages a lineage's research starts from: the version's research URLs. One slow or
 * refusing site must not end the research while the others answered, and no failure is silent:
 * every source that could not be read is returned with its url, the reason and when it was
 * tried, for the run result and the proposal sheet to carry. Whether no page at all is enough
 * to stop is the caller's decision.
 */
export const fetchStatutoryPages = (
	api: PageReader,
	researchUrls: readonly string[],
	officialUrl: (url: string) => URL | null
): Effect.Effect<StatutoryPagesRead> =>
	Effect.gen(function* () {
		const urls = [...new Set(researchUrls)];
		if (urls.length === 0 || urls.length > RESEARCH_FETCH_LIMITS.maxEntryUrls)
			refuse('A researched version names between one and thirty-two official research URLs.');
		const retrievedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
		const exits = yield* Effect.forEach(
			urls,
			(url) => Effect.exit(fetchStatutoryPage(api, url, officialUrl, retrievedAt)),
			{ concurrency: RESEARCH_FETCH_LIMITS.concurrency }
		);
		const pages: ResearchPage[] = [];
		const unreachable: UnreachableSource[] = [];
		for (const [index, exit] of exits.entries()) {
			if (Exit.isSuccess(exit)) pages.push(exit.value);
			else
				unreachable.push({
					url: urls[index]!,
					reason: unreachableReason(exit.cause),
					retrieved_at: retrievedAt
				});
		}
		return { pages, unreachable };
	});

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

/** How many pages one research turn may open beyond its entry pages, and how much of each it sees. */
const RESEARCH_TOOL_LIMITS = { perPageChars: 12_000, maxLinks: 40, maxPages: 12 } as const;

/**
 * The tool the research model navigates with: open one page on an allowed origin by exact URL
 * and get back its statutory sentences and links. Every page it opens lands in `pages`, so quote
 * verification runs against exactly what the model saw. A disallowed origin, a redirect off it
 * or an empty page is a refusal the model reads as a failed tool result and routes around.
 */
export const statutoryResearchTool = (
	api: PageReader,
	officialUrl: (url: string) => URL | null,
	pages: ResearchPage[]
): InferenceTool<{ readonly url: string }> => ({
	name: 'read_official_page',
	description:
		'Open one official statutory page by its exact HTTPS URL and return its statutory sentences and the links it carries. Only the origins the settings version names as research URLs are fetched; follow a link from an entry page when the contribution table, leave entitlement or effective-date notice you need is on another page.',
	input: Schema.Struct({ url: Schema.NonEmptyString }),
	run: ({ url }) =>
		Effect.gen(function* () {
			const known = pages.find((page) => page.url === url || page.requested_url === url);
			if (known === undefined && pages.length >= RESEARCH_TOOL_LIMITS.maxPages)
				refuse(
					`This research turn already opened ${RESEARCH_TOOL_LIMITS.maxPages} pages; answer from the pages you have.`
				);
			const page =
				known ??
				(yield* fetchStatutoryPage(
					api,
					url,
					officialUrl,
					new Date(yield* Clock.currentTimeMillis).toISOString()
				));
			if (known === undefined) pages.push(page);
			const [view] = researchPromptPages([page], officialUrl, {
				perPageChars: RESEARCH_TOOL_LIMITS.perPageChars,
				totalChars: RESEARCH_TOOL_LIMITS.perPageChars,
				maxLinks: RESEARCH_TOOL_LIMITS.maxLinks
			});
			return { url: page.url, text: view?.text ?? page.text, links: [...(view?.links ?? [])] };
		})
});

const evidence = {
	/** The exact URL of a page that was given or opened. */
	source_url: Schema.NonEmptyString,
	/** A short passage copied exactly from that page, which the automation verifies. */
	quote: Schema.NonEmptyString
} as const;

export const rateBandSchema = Schema.Struct({
	selector: rateSelectorValueSchema,
	award: rateAwardValueSchema
});

/**
 * What the model returns per lineage: the official position of each statutory row it found
 * evidence for, in the row's own shape. A row with no evidence on the pages is omitted, never
 * guessed. A band table is complete or absent.
 */
export const StatutoryFindingsSchema = Schema.Struct({
	contributions: Schema.Array(
		Schema.Struct({ code: Schema.NonEmptyString, bands: Schema.Array(rateBandSchema), ...evidence })
	),
	leave_types: Schema.Array(
		Schema.Struct({
			code: Schema.NonEmptyString,
			entitlement: leaveEntitlementValueSchema,
			...evidence
		})
	),
	pay_components: Schema.Array(
		Schema.Struct({
			code: Schema.NonEmptyString,
			contribution_treatments: contributionTreatmentsValueSchema,
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
			authority: string;
			bands: ReadonlyArray<Schema.Schema.Type<typeof rateBandSchema>>;
		}>
	>;
	leave_types: ReadonlyArray<
		Readonly<{ code: string; name: string; authority: string | null; entitlement: unknown }>
	>;
	pay_components: ReadonlyArray<Readonly<{ code: string; contribution_treatments: unknown }>>;
}>;

/** A band table in canonical order, so two spellings of one table compare equal. */
const canonicalBands = (bands: ReadonlyArray<unknown>): string =>
	stableJson([...bands.map(stableJson)].toSorted());

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
		if (canonicalBands(scheme.bands) === canonicalBands(finding.bands)) continue;
		const page = verified(finding, 'Scheme');
		if (page == null) continue;
		changes.push(change('contribution_rates', 'bands', finding, page, scheme.bands, finding.bands));
	}
	for (const finding of findings.leave_types) {
		const type = sealed.leave_types.find((row) => row.code === finding.code);
		if (type == null) {
			notes.push(`Leave type ${finding.code}: not a statutory leave type of this version`);
			continue;
		}
		if (stableJson(type.entitlement) === stableJson(finding.entitlement)) continue;
		const page = verified(finding, 'Leave type');
		if (page == null) continue;
		changes.push(
			change('leave_types', 'entitlement', finding, page, type.entitlement, finding.entitlement)
		);
	}
	for (const finding of findings.pay_components) {
		const component = sealed.pay_components.find((row) => row.code === finding.code);
		if (component == null) {
			notes.push(`Pay component ${finding.code}: not a statutory component of this version`);
			continue;
		}
		if (
			stableJson(component.contribution_treatments) === stableJson(finding.contribution_treatments)
		)
			continue;
		const page = verified(finding, 'Pay component');
		if (page == null) continue;
		changes.push(
			change(
				'pay_components',
				'contribution_treatments',
				finding,
				page,
				component.contribution_treatments,
				finding.contribution_treatments
			)
		);
	}
	return { changes, notes: [...notes, ...findings.notes] };
}
