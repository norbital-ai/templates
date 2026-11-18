/**
 * Parses cited company research Markdown (`[n]` inline citations + `[n] [Title](url)` reference lines)
 * into clean Markdown prose, structured references, and Wikipedia-style interactive citation links.
 */

export type Reference = {
	readonly n: number;
	readonly title: string;
	readonly url: string;
	readonly host: string;
};

export type ParsedResearch = {
	readonly markdown: string;
	readonly references: readonly Reference[];
	readonly byNumber: ReadonlyMap<number, Reference>;
};

const REF_LINE = /^\[(\d+)\]\s+(?:\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/\S+))\s*$/;
const MD_REF_LINE = /^\[(\d+)\]:\s*(https?:\/\/\S+)(?:\s+"([^"]*)")?\s*$/;

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

/**
 * Extracts `[n] [Title](url)` reference definitions (whether grouped under `## References` or per-section),
 * strips the raw reference lines from the body, normalizes dense prose paragraphs into readable Markdown,
 * and rewrites inline `[n]` markers to `#hq-ref-n` links so `ReadonlyMarkdown` renders clickable citation pills.
 */
export function parseResearch(raw: string | null | undefined): ParsedResearch {
	if (raw == null || raw.trim() === '') {
		return { markdown: '', references: [], byNumber: new Map() };
	}

	const lines = raw.replace(/\r\n/g, '\n').split('\n');
	const refs = new Map<number, Reference>();
	const bodyLines: string[] = [];
	let inReferencesHeading = false;

	for (const line of lines) {
		const trimmed = line.trim();
		if (/^#{1,3}\s+References\s*$/i.test(trimmed)) {
			inReferencesHeading = true;
			continue;
		}
		const match = REF_LINE.exec(trimmed) ?? MD_REF_LINE.exec(trimmed);
		if (match) {
			const n = Number(match[1]);
			const url = (match[3] ?? match[4] ?? match[2] ?? '').trim();
			const title = (match[2] ?? match[3] ?? '').trim() || hostOf(url);
			if (Number.isFinite(n) && url !== '' && !refs.has(n)) {
				refs.set(n, { n, title, url, host: hostOf(url) });
			}
			continue;
		}
		if (inReferencesHeading && trimmed === '') continue;
		if (/^#{1,3}\s+/.test(trimmed)) inReferencesHeading = false;
		bodyLines.push(line);
	}

	// If a section had bold lead-ins like "What it does. ..." at paragraph starts, promote them cleanly to bold leads.
	const cleaned = bodyLines
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
		.split('\n\n')
		.map((block) =>
			/^(#{1,6}\s|[-*+]\s|\d+\.\s|>|```)/.test(block)
				? block
				: block.replace(/^([A-Z][^.:\n]{2,36})\.\s+/, '**$1.** ')
		)
		.join('\n\n');

	const linked = linkCitations(cleaned, refs);
	const references = [...refs.values()].sort((a, b) => a.n - b.n);
	return { markdown: linked, references, byNumber: refs };
}

/** Rewrites inline `[n]` citations into `[^{n}](#hq-ref-n)` Markdown links when `n` is a known reference. */
export function linkCitations(text: string, refs: ReadonlyMap<number, Reference>): string {
	return text.replace(/\[(\d+)\](?!\()/g, (full, raw) => {
		const n = Number(raw);
		return refs.has(n) ? `[[${n}]](#hq-ref-${n})` : full;
	});
}

/** Splits a use-case string (`Title: description` or `Title — description`) into heading + Markdown body. */
export function parseUseCase(raw: string): { readonly title: string; readonly body: string } {
	const trimmed = raw.trim();
	const colon = /^([^:\n]{3,90}):\s+([\s\S]+)$/.exec(trimmed);
	if (colon?.[1] !== undefined && colon[2] !== undefined)
		return { title: colon[1].trim(), body: colon[2].trim() };
	const dash = /^([^—\n]{3,90})\s+—\s+([\s\S]+)$/.exec(trimmed);
	if (dash?.[1] !== undefined && dash[2] !== undefined)
		return { title: dash[1].trim(), body: dash[2].trim() };
	return { title: '', body: trimmed };
}
