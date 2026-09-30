/**
 * The obligation-tracker rows behind each rule-map node. A tracker row names where it is
 * configured in `config_path` (`statutory_contributions:<code>`, `terms_facts:<key>`,
 * `work_rules.<part>`, several `;`-separated); a node carries the same paths, so the match is
 * textual and knows no jurisdiction. The rows are the tracker CSVs (`docs/inventory/README.md`).
 */

export type TrackerRow = {
	readonly id: string;
	readonly profile: string;
	readonly area: string;
	readonly provision: string;
	readonly citation: string;
	readonly effective_from: string;
	readonly effective_to: string;
	readonly status: string;
	readonly reason: string;
	readonly config_path: string;
	readonly probe: string;
	readonly verified_at: string;
};

/** RFC 4180: `"`-quoted fields may hold commas, quotes (`""`) and newlines; the first line is the header. */
export function parseCsv(text: string): readonly Readonly<Record<string, string>>[] {
	const records: string[][] = [];
	let record: string[] = [];
	let field = '';
	let quoted = false;
	for (let index = 0; index < text.length; index++) {
		const char = text[index]!;
		if (quoted) {
			if (char === '"' && text[index + 1] === '"') {
				field += '"';
				index++;
			} else if (char === '"') quoted = false;
			else field += char;
		} else if (char === '"') quoted = true;
		else if (char === ',') {
			record.push(field);
			field = '';
		} else if (char === '\n' || char === '\r') {
			if (char === '\r' && text[index + 1] === '\n') index++;
			record.push(field);
			records.push(record);
			record = [];
			field = '';
		} else field += char;
	}
	if (field !== '' || record.length > 0) records.push([...record, field]);
	const [header, ...rows] = records.filter((row) => row.some((cell) => cell !== ''));
	if (header == null) return [];
	return rows.map((row) => Object.fromEntries(header.map((name, at) => [name, row[at] ?? ''])));
}

export function trackerRows(text: string): readonly TrackerRow[] {
	return parseCsv(text).map((row) => ({
		id: row.id ?? '',
		profile: row.profile ?? '',
		area: row.area ?? '',
		provision: row.provision ?? '',
		citation: row.citation ?? '',
		effective_from: row.effective_from ?? '',
		effective_to: row.effective_to ?? '',
		status: row.status ?? '',
		reason: row.reason ?? '',
		config_path: row.config_path ?? '',
		probe: row.probe ?? '',
		verified_at: row.verified_at ?? ''
	}));
}

/** The rows of a lineage: its own profile, its jurisdiction's, and the lineage's sub-profiles. */
export function trackerRowsOf(
	rows: readonly TrackerRow[],
	version: { readonly code: string; readonly jurisdiction_code: string }
): readonly TrackerRow[] {
	return rows.filter(
		(row) =>
			row.profile === version.code ||
			row.profile === version.jurisdiction_code ||
			row.profile.startsWith(`${version.code}-`)
	);
}

type Segment = { readonly head: string; readonly codes: readonly string[] | null };
const parsed = new Map<string, readonly Segment[]>();

/** One `config_path` as its segments: a trailing ` (…)` note dropped, `head:A,B` split into codes. */
function segments(configPath: string): readonly Segment[] {
	const cached = parsed.get(configPath);
	if (cached !== undefined) return cached;
	const found = configPath
		.split(';')
		.map((segment) => segment.replace(/\s*\(.*$/s, '').trim())
		.filter((segment) => segment !== '')
		.map((segment) => {
			const colon = segment.indexOf(':');
			return colon < 0
				? { head: segment, codes: null }
				: {
						head: segment.slice(0, colon).trim(),
						codes: segment
							.slice(colon + 1)
							.split(',')
							.map((code) => code.trim())
					};
		});
	parsed.set(configPath, found);
	return found;
}

/**
 * Whether a tracker `config_path` names a node path. `head:code` matches a segment `head:…,code,…`
 * or `head.code[.…]`; a dotted path matches itself or any path under it (`work_rules.limits`
 * matches `work_rules.limits.daily`), never a parent, so a row naming a whole root marks no node.
 */
export function configPathNames(configPath: string, nodePath: string): boolean {
	const colon = nodePath.indexOf(':');
	const head = colon < 0 ? nodePath : nodePath.slice(0, colon);
	const code = colon < 0 ? null : nodePath.slice(colon + 1);
	return segments(configPath).some((segment) => {
		if (code != null)
			return (
				(segment.head === head && (segment.codes ?? []).includes(code)) ||
				(segment.codes == null &&
					(segment.head === `${head}.${code}` || segment.head.startsWith(`${head}.${code}.`)))
			);
		return (
			segment.codes == null &&
			(segment.head === nodePath || segment.head.startsWith(`${nodePath}.`))
		);
	});
}

/** The tracker rows naming any of a node's paths. */
export function rowsForNode(
	rows: readonly TrackerRow[],
	config: readonly string[]
): readonly TrackerRow[] {
	return config.length === 0
		? []
		: rows.filter((row) => config.some((path) => configPathNames(row.config_path, path)));
}

/** A tracker citation as its title and first link: `Act 1955 reprint (https://…) …` → both halves. */
export function citationParts(citation: string): {
	readonly title: string;
	readonly url: string | null;
} {
	const url = /https?:\/\/[^\s)]+/.exec(citation)?.[0] ?? null;
	const title = (url == null ? citation : citation.slice(0, citation.indexOf(url)))
		.replace(/[\s(]+$/, '')
		.trim();
	return { title: title === '' ? (url ?? '') : title, url };
}
