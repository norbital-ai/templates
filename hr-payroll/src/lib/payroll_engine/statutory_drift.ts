/**
 * L-TPL-hr-payroll-113: official-source URLs on a settings version, the rows a research changed with the evidence
 * their own references cite, and quote checks against fetched pages. The automation never seals.
 */
import { Predicate, Result, Schema } from 'effect';
import type { StatutorySnapshot } from './statutory_snapshot.js';
import { RESEARCH_AGENT_NAMES, type ResearchAgent } from './research_agents.js';

const isString = Schema.is(Schema.String);
const isUnknownArray = Schema.is(Schema.Array(Schema.Unknown));
const URL_TEXT = /^https?:\/\//i;

type DriftEntry = {
	readonly agent: ResearchAgent;
	readonly url: string;
	readonly instructions: string;
	readonly document_origins: readonly string[];
};
type DriftSources = {
	readonly urls: readonly string[];
	readonly entries: readonly DriftEntry[];
	/** Each agent's supplementary instructions for the jurisdiction. */
	readonly agents: Partial<Readonly<Record<ResearchAgent, string>>>;
	/** Every registered origin: entry urls and their document origins. */
	readonly research_domains: readonly string[];
};

type DriftQuote = { readonly url: string; readonly quote: string };

type DriftPage = {
	readonly url: string;
	readonly title: string | null;
	readonly text: string;
};

function urlList(value: unknown): string[] {
	if (!isUnknownArray(value)) return [];
	return value.filter((item): item is string => isString(item) && URL_TEXT.test(item));
}

const isAgent = Schema.is(Schema.Literals(RESEARCH_AGENT_NAMES));
export function sourcesFrom(value: unknown): DriftSources {
	const record = Predicate.isObject(value) ? value : {};
	const entries = isUnknownArray(record.entries)
		? record.entries.flatMap((item) =>
				Predicate.isObject(item) &&
				isAgent(item.agent) &&
				isString(item.url) &&
				URL_TEXT.test(item.url) &&
				isString(item.instructions) &&
				item.instructions.trim() !== ''
					? [
							{
								agent: item.agent,
								url: item.url,
								instructions: item.instructions,
								document_origins: urlList(item.document_origins)
							}
						]
					: []
			)
		: [];
	const agents = Predicate.isObject(record.agents)
		? Object.fromEntries(
				RESEARCH_AGENT_NAMES.flatMap((name) => {
					const text = Predicate.isObject(record.agents) ? record.agents[name] : undefined;
					return isString(text) && text.trim() !== '' ? [[name, text]] : [];
				})
			)
		: {};
	const urls = entries.map((item) => item.url);
	return {
		urls,
		entries,
		agents,
		research_domains: [...urls, ...entries.flatMap((entry) => entry.document_origins)]
	};
}

function originOf(url: string): string | null {
	return Result.getOrElse(
		Result.try(() => new URL(url).origin.toLowerCase()),
		() => null
	);
}

/** A URL is admitted when it is listed, or its origin matches `research_domains`. */
export function allowedUrl(url: string, sources: DriftSources): boolean {
	if (!URL_TEXT.test(url)) return false;
	if (sources.urls.includes(url)) return true;
	const origin = originOf(url);
	if (origin == null) return false;
	return sources.research_domains.some((domain) => originOf(domain) === origin);
}

/**
 * A quote is its words and numbers: a PDF's text breaks lines and splits tokens ("60KA." extracts as "60 ka ."), and
 * punctuation and dashes vary, so only letters and digits are compared.
 */
const wording = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export function quotePresent(text: string, quote: string): boolean {
	const needle = wording(quote);
	if (needle.length < 8) return false;
	return wording(text).includes(needle);
}

export function unverifiedQuotes(
	pages: readonly DriftPage[],
	quotes: readonly DriftQuote[],
	sources: DriftSources
): DriftQuote[] {
	return quotes.filter((row) => {
		if (!allowedUrl(row.url, sources)) return true;
		const page = pages.find((item) => item.url === row.url);
		return page == null || !quotePresent(page.text, row.quote);
	});
}

export function pageFrom(value: unknown): DriftPage | null {
	if (
		!Predicate.isObject(value) ||
		'kind' in value ||
		!isString(value.url) ||
		!isString(value.text)
	) {
		return null;
	}
	return {
		url: value.url,
		title: isString(value.title) ? value.title : null,
		text: value.text
	};
}

type RowChange = {
	readonly section: string;
	readonly code: string;
	readonly added: boolean;
	readonly fields: readonly string[];
	/** The row's references with `url` and `quote` that its previous version did not carry. */
	readonly evidence: readonly DriftQuote[];
};

function rowEvidence(row: unknown): DriftQuote[] {
	if (!Predicate.isObject(row) || !isUnknownArray(row.references)) return [];
	return row.references.flatMap((item) =>
		Predicate.isObject(item) && isString(item.url) && isString(item.quote)
			? [{ url: item.url, quote: item.quote }]
			: []
	);
}

/** The settings object is one row of its own: its fields are what changed, its references their evidence. */
const SETTINGS = 'settings';
function rowOf(snapshot: unknown, section: string, code: string): unknown {
	if (section === SETTINGS) return Predicate.isObject(snapshot) ? snapshot[SETTINGS] : undefined;
	const rows = Predicate.isObject(snapshot) ? snapshot[section] : undefined;
	return isUnknownArray(rows)
		? rows.find((row) => Predicate.isObject(row) && row.code === code)
		: undefined;
}

/**
 * The keyed rows a research changed or added (from `jsonDiff` paths `/<section>/<code>/<field>`), each with the fresh
 * evidence its own references cite (none when it cites no new url + quote: the caller leaves that row out); otherwise
 * why a change cannot be evidenced on a row: a settings change or a removed row. A removal (a removed or renamed code)
 * is never drafted: no row is left to carry its evidence, so a repeal stays in `unresolved` for a person.
 */
export function rowChanges(
	before: unknown,
	after: unknown,
	changes: readonly { readonly path: string }[]
): Result.Result<RowChange[], string> {
	const touched = new Map<string, { section: string; code: string; fields: Set<string> }>();
	for (const { path } of changes) {
		const [section, second, third] = path
			.split('/')
			.slice(1)
			.map((key) => key.replaceAll('~1', '/').replaceAll('~0', '~'));
		const [code, field] = section === SETTINGS ? [SETTINGS, second] : [second, third];
		if (section === undefined || code === undefined)
			return Result.fail(`a change outside any row (${path})`);
		const id = JSON.stringify([section, code]);
		const row = touched.get(id) ?? { section, code, fields: new Set<string>() };
		if (field !== undefined) row.fields.add(field);
		touched.set(id, row);
	}
	const rows: RowChange[] = [];
	for (const { section, code, fields } of touched.values()) {
		const now = rowOf(after, section, code);
		if (now === undefined) return Result.fail(`removed ${section}/${code}`);
		const previous = rowOf(before, section, code);
		const known = rowEvidence(previous);
		const evidence = rowEvidence(now).filter(
			(cite) => !known.some((old) => old.url === cite.url && old.quote === cite.quote)
		);
		rows.push({ section, code, added: previous === undefined, fields: [...fields], evidence });
	}
	return Result.succeed(rows);
}

/** The version's change summary: the diff's rows per section, then the model's own paragraph. */
/** One section's rows with each dropped code put back as it was (a dropped addition removed). */
function revert<R extends { readonly code: string }>(
	before: readonly R[],
	after: readonly R[],
	drop: ReadonlySet<string>
): R[] {
	const kept = after.flatMap((row) => {
		if (!drop.has(row.code)) return [row];
		const was = before.find((old) => old.code === row.code);
		return was === undefined ? [] : [was];
	});
	return kept;
}

/**
 * The corrected snapshot without the rows whose evidence did not hold: each goes back to the governing version's row,
 * an added one is left out. The draft keeps every row whose evidence was verified.
 */
export function withoutRows(
	before: StatutorySnapshot,
	after: StatutorySnapshot,
	drop: readonly { readonly section: string; readonly code: string }[]
): StatutorySnapshot {
	const codes = (section: string) =>
		new Set(drop.filter((row) => row.section === section).map((row) => row.code));
	return {
		...after,
		settings: codes(SETTINGS).size === 0 ? after.settings : before.settings,
		behaviour_rule: revert(before.behaviour_rule, after.behaviour_rule, codes('behaviour_rule')),
		adhoc_catalog: revert(before.adhoc_catalog, after.adhoc_catalog, codes('adhoc_catalog')),
		allowance_catalog: revert(
			before.allowance_catalog,
			after.allowance_catalog,
			codes('allowance_catalog')
		),
		claim_catalog: revert(before.claim_catalog, after.claim_catalog, codes('claim_catalog')),
		leave_catalog: revert(before.leave_catalog, after.leave_catalog, codes('leave_catalog')),
		loan_catalog: revert(before.loan_catalog, after.loan_catalog, codes('loan_catalog')),
		work_catalog: revert(before.work_catalog, after.work_catalog, codes('work_catalog')),
		statutory_contribution_catalog: revert(
			before.statutory_contribution_catalog,
			after.statutory_contribution_catalog,
			codes('statutory_contribution_catalog')
		),
		suspension_kind: revert(
			before.suspension_kind,
			after.suspension_kind,
			codes('suspension_kind')
		),
		rule_set: revert(before.rule_set, after.rule_set, codes('rule_set'))
	};
}

export function changeSummary(rows: readonly RowChange[], summary: string): string {
	const sections = [...new Set(rows.map((row) => row.section))].map(
		(section) =>
			`${section}: ${rows
				.filter((row) => row.section === section)
				.map((row) =>
					row.added || row.fields.length === 0
						? `${row.added ? 'added' : 'changed'} ${row.code}`
						: `changed ${row.code} (${row.fields.join(', ')})`
				)
				.join('; ')}`
	);
	return [...sections, '', summary.trim()].join('\n');
}

export function lineageCodes(rows: readonly { readonly code: string }[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const row of rows) {
		if (seen.has(row.code)) continue;
		seen.add(row.code);
		out.push(row.code);
	}
	return out;
}
