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
};
type DriftSources = {
	readonly urls: readonly string[];
	readonly entries: readonly DriftEntry[];
	/** Each agent's supplementary instructions for the jurisdiction. */
	readonly agents: Partial<Readonly<Record<ResearchAgent, string>>>;
	/** The official sites the entries are on (see `siteOf`). */
	readonly sites: readonly string[];
};

type DriftQuote = { readonly url: string; readonly quote: string };

type DriftPage = {
	readonly url: string;
	readonly title: string | null;
	readonly text: string;
};

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
					? [{ agent: item.agent, url: item.url, instructions: item.instructions }]
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
	return { urls, entries, agents, sites: [...new Set(urls.flatMap((url) => siteOf(url) ?? []))] };
}

/**
 * The official site a URL is on: a government's whole domain (`gov.my`, `go.id`), otherwise the registered name
 * (`chinhphu.vn`, `kyoukaikenpo.or.jp`). An instrument is often served from another host of the same site (a CDN).
 * ponytail: a short list of generic second-level labels, the Public Suffix List if a jurisdiction needs more.
 */
const GENERIC = /^(or|co|com|ac|org|net|edu|ne|gob|govt|mil)$/;
export function siteOf(url: string): string | null {
	const host = URL_TEXT.test(url) ? URL.parse(url)?.hostname.toLowerCase() : undefined;
	if (host == null) return null;
	const labels = host.split('.');
	const second = labels.at(-2) ?? '';
	return labels.slice(/^(gov|go)$/.test(second) ? -2 : GENERIC.test(second) ? -3 : -2).join('.');
}

/** A URL is admitted when it is on one of the registered official sites. */
export function allowedUrl(url: string, sources: DriftSources): boolean {
	const site = siteOf(url);
	return site != null && sources.sites.includes(site);
}

/**
 * A quote is its words and numbers: a PDF's text breaks lines and splits tokens ("60KA." extracts as "60 ka ."), and
 * punctuation and dashes vary, so only letters and digits are compared; an extracted document's page markers are not
 * its wording. A quote elided with "..." or "…" holds when each part is on the page, in order.
 */
const wording = (text: string) =>
	text
		.replace(/\[Page \d+\]/g, ' ')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '');
export function quotePresent(text: string, quote: string): boolean {
	const parts = quote
		.split(/\.{3}|…/)
		.map(wording)
		.filter((part) => part !== '');
	if (parts.length === 0 || parts.some((part) => part.length < 8)) return false;
	const page = wording(text);
	let from = 0;
	for (const part of parts) {
		const at = page.indexOf(part, from);
		if (at < 0) return false;
		from = at + part.length;
	}
	return true;
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
