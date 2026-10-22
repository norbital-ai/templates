/**
 * L-TPL-hr-payroll-113: official-source URLs on a settings version, the rows a research changed with the evidence
 * their own references cite, and quote checks against fetched pages. The automation never seals.
 */
import { Predicate, Result, Schema } from 'effect';

const isString = Schema.is(Schema.String);
const isUnknownArray = Schema.is(Schema.Array(Schema.Unknown));
const URL_TEXT = /^https?:\/\//i;

type DriftSources = {
	readonly urls: readonly string[];
	readonly entries?: readonly {
		readonly url: string;
		readonly instructions: string;
		readonly document_origins?: readonly string[];
	}[];
	readonly instructions?: string;
	readonly research_domains?: readonly string[];
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

export function sourcesFrom(value: unknown): DriftSources {
	if (!Predicate.isObject(value)) return { urls: [] };
	const entries = isUnknownArray(value.entries)
		? value.entries.flatMap((item) =>
				Predicate.isObject(item) &&
				isString(item.url) &&
				URL_TEXT.test(item.url) &&
				isString(item.instructions) &&
				item.instructions.trim() !== ''
					? [
							{
								url: item.url,
								instructions: item.instructions,
								document_origins: urlList(item.document_origins)
							}
						]
					: []
			)
		: [];
	const urls = entries.length > 0 ? entries.map((item) => item.url) : urlList(value.urls);
	const research_domains =
		entries.length > 0
			? [...urls, ...entries.flatMap((entry) => entry.document_origins)]
			: urlList(value.research_domains);
	const instructions = isString(value.instructions) ? value.instructions : undefined;
	return {
		urls,
		...(entries.length === 0 ? {} : { entries }),
		...(instructions == null || instructions === '' ? {} : { instructions }),
		...(research_domains.length === 0 ? {} : { research_domains })
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
	return (sources.research_domains ?? []).some((domain) => originOf(domain) === origin);
}

export function quotePresent(text: string, quote: string): boolean {
	const needle = quote.trim().toLowerCase();
	if (needle.length < 8) return false;
	return text.toLowerCase().includes(needle);
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

function rowOf(snapshot: unknown, section: string, code: string): unknown {
	const rows = Predicate.isObject(snapshot) ? snapshot[section] : undefined;
	return isUnknownArray(rows)
		? rows.find((row) => Predicate.isObject(row) && row.code === code)
		: undefined;
}

/**
 * The keyed rows a research changed or added (from `jsonDiff` paths `/<section>/<code>/<field>`), each with the fresh
 * evidence its own references cite; otherwise why a change cannot be evidenced on a row: a settings change, a row
 * without fresh url + quote, or a removed row. A removal (a removed or renamed code) is never drafted: no row is left
 * to carry its evidence, so a repeal stays in `unresolved` for a person.
 */
export function rowChanges(
	before: unknown,
	after: unknown,
	changes: readonly { readonly path: string }[]
): Result.Result<RowChange[], string> {
	const touched = new Map<string, { section: string; code: string; fields: Set<string> }>();
	for (const { path } of changes) {
		const [section, code, field] = path
			.split('/')
			.slice(1)
			.map((key) => key.replaceAll('~1', '/').replaceAll('~0', '~'));
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
		if (now === undefined)
			return Result.fail(
				section === 'settings' ? `a settings change (${code})` : `removed ${section}/${code}`
			);
		const previous = rowOf(before, section, code);
		const known = rowEvidence(previous);
		const evidence = rowEvidence(now).filter(
			(cite) => !known.some((old) => old.url === cite.url && old.quote === cite.quote)
		);
		if (evidence.length === 0) return Result.fail(`${section}/${code} cites no new url and quote`);
		rows.push({ section, code, added: previous === undefined, fields: [...fields], evidence });
	}
	return Result.succeed(rows);
}

/** The version's change summary: the diff's rows per section, then the model's own paragraph. */
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
