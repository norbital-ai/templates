/**
 * L-TPL-hr-payroll-113: official-source URLs on a settings version, quote checks against fetched pages,
 * and whether a lineage should raise an unsealed draft. The automation never seals.
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

type DriftFinding = {
	readonly changed: boolean;
	readonly summary: string;
	readonly quotes: readonly DriftQuote[];
};

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

export function findingFrom(value: unknown): DriftFinding {
	if (!Predicate.isObject(value)) return { changed: false, summary: '', quotes: [] };
	const quotes: DriftQuote[] = [];
	if (isUnknownArray(value.quotes)) {
		for (const item of value.quotes) {
			if (!Predicate.isObject(item) || !isString(item.url) || !isString(item.quote)) continue;
			quotes.push({ url: item.url, quote: item.quote });
		}
	}
	return {
		changed: value.changed === true,
		summary: isString(value.summary) ? value.summary : '',
		quotes
	};
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

export function shouldDraft(finding: DriftFinding, unverified: readonly DriftQuote[]): boolean {
	return (
		finding.changed &&
		finding.summary.trim() !== '' &&
		finding.quotes.length > 0 &&
		unverified.length === 0
	);
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
