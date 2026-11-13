import { inForce, type Change } from '../dated.js';
import { LAW_DEPTH, LAW_ROWS } from '../law.js';
import type { JsonObject } from './contracts.js';
import { isDynObject, isJsonObject, stableJson, type Json } from './foundation.js';

/** The law's own blocks as a finding's family; a change to one names no `row_code`. */
export const SETTINGS_FAMILY = 'jurisdiction';
/** A change's `field_path` when it adds or removes a whole catalogue row. */
export const WHOLE_ROW = '$row';
/** The blocks of a law that are not rows: a change with no `row_code` starts its path at one of them. */
const BLOCKS = [
	'conversions',
	'ledger',
	'lookup',
	'work_regions',
	'employee_extension_schema',
	'entity_extension_schema'
];
/** A change never moves a row's code or its place in the chain. */
const PROTECTED = new Set(['code', 'previous']);
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);

/** An official host: government, tax or social-security domains of the workspace's jurisdictions. */
export const officialSource = (url: string): boolean => {
	const parsed = URL.parse(url);
	return parsed?.protocol === 'https:' && /\.(gov|go)(\.[a-z]{2})?$/.test(parsed.hostname);
};
/** The host a source lives on, empty for what is not a URL; sources move page by page, rarely host by host. */
export const hostOf = (url: string): string => URL.parse(url)?.hostname ?? '';
/** A citation as a stable key: the same instrument, however a run spells it, is one finding. */
export const instrumentKey = (instrument: string): string =>
	instrument
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-|-$/g, '');

export const FAMILIES = [
	'leave_catalog',
	'claim_catalog',
	'adhoc_catalog',
	'loan_catalog',
	'allowance_catalog',
	'overtime_catalog',
	'statutory_contribution_catalog',
	'workplace_case_catalog',
	'work_event_catalog'
] as const;

/** The taxonomy a finding is classified against: what each family holds, as research reads it. */
export const FAMILY_NOTES: { readonly [family: string]: string } = {
	[SETTINGS_FAMILY]:
		'Jurisdiction-wide values and shapes: `lookup` constants, `conversions` and rounding, the ledger scope, work regions, the employee and entity extension schemas.',
	leave_catalog: 'Statutory and contractual leave entitlements.',
	claim_catalog: 'Reimbursable expense types.',
	adhoc_catalog: 'One-off pay and deduction items.',
	loan_catalog: 'Employee loan and advance types.',
	allowance_catalog: 'Recurring allowances and their statutory treatment.',
	overtime_catalog: 'Overtime and premium-pay rates.',
	statutory_contribution_catalog:
		'Contribution and tax schemes an employee or employer pays, each with rates and ceilings in `lookup`.',
	workplace_case_catalog: 'Workplace case types such as injury or disciplinary cases.',
	work_event_catalog: 'Dated work conditions such as heat, disaster, epidemic or suspension.'
};

const known_family = (family: string): boolean => Object.hasOwn(FAMILY_NOTES, family);

/** A finding as a run reports it. */
export type ReportedFinding = {
	readonly instrument: string;
	readonly title: string;
	readonly fit: 'VALUE' | 'ROW' | 'STRUCTURAL';
	readonly families?: readonly string[] | null | undefined;
	readonly summary?: string | null | undefined;
	readonly announced_on?: string | null | undefined;
	readonly source_urls?: readonly string[] | null | undefined;
	readonly source_quote?: string | null | undefined;
	readonly notes?: string | null | undefined;
};
export type KnownFinding = {
	readonly id: string;
	readonly instrument_key: string;
	readonly status: string;
	readonly source_urls: readonly string[];
};
const isDate = (value: string | null | undefined): value is string =>
	value != null && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * What a discovery run's answer does to the ledger. An instrument already on file never opens a second row: a proposed
 * one gains the new sources, and one a person decided stays decided, rejected included. Pure.
 */
export const sortFindings = (
	reported: readonly ReportedFinding[],
	known: readonly KnownFinding[]
) => {
	const fresh = new Map<
		string,
		Omit<ReportedFinding, 'instrument'> & { readonly instrument_key: string }
	>();
	const merged = new Map<string, readonly string[]>();
	const decided: string[] = [];
	for (const { instrument, ...finding } of reported) {
		const instrument_key = instrumentKey(instrument);
		if (instrument_key === '') continue;
		const urls = finding.source_urls ?? [];
		const families = (finding.families ?? []).filter(known_family);
		const on_file = known.find((row) => row.instrument_key === instrument_key);
		if (on_file === undefined) {
			const earlier = fresh.get(instrument_key);
			fresh.set(instrument_key, {
				...(earlier ?? finding),
				instrument_key,
				// what names no known family cannot be drafted as data: a person decides how to model it
				fit: families.length === 0 ? 'STRUCTURAL' : (earlier?.fit ?? finding.fit),
				families: [...new Set([...(earlier?.families ?? []), ...families])],
				announced_on: isDate(finding.announced_on) ? finding.announced_on : null,
				source_urls: [...new Set([...(earlier?.source_urls ?? []), ...urls])]
			});
		} else if (on_file.status !== 'PROPOSED') decided.push(instrument_key);
		else {
			const added = urls.filter((url) => !on_file.source_urls.includes(url));
			if (added.length > 0) merged.set(on_file.id, [...on_file.source_urls, ...added]);
			decided.push(instrument_key);
		}
	}
	return { fresh: [...fresh.values()], merged: [...merged], decided };
};

/** The hosts a law's `references` cite and the ledger does not hold yet, as sources; only official ones start active. */
export const referenceSources = (
	rows: readonly JsonObject[],
	held: readonly string[]
): readonly {
	readonly title: string;
	readonly url: string;
	readonly status: 'ACTIVE' | 'PROPOSED';
}[] => {
	const hosts = new Map<string, { title: string; url: string; status: 'ACTIVE' | 'PROPOSED' }>();
	for (const reference of rows.flatMap((row) =>
		Array.isArray(row.references) ? row.references : []
	)) {
		if (!isDynObject(reference) || typeof reference.url !== 'string') continue;
		const origin = URL.parse(reference.url)?.origin;
		// an archive mirrors other hosts; it is nobody's source
		if (origin === undefined || hostOf(origin) === 'web.archive.org') continue;
		if (held.includes(origin) || hosts.has(origin)) continue;
		hosts.set(origin, {
			title: hostOf(origin),
			url: origin,
			status: officialSource(origin) ? 'ACTIVE' : 'PROPOSED'
		});
	}
	return [...hosts.values()];
};

export type ReportedChange = {
	readonly row_code?: string | null | undefined;
	readonly field_path: string;
	readonly new_value?: Json | null | undefined;
	readonly effective_from?: string | null | undefined;
	readonly notes?: string | null | undefined;
};
/** A patch of a law from a date: what one `jurisdiction_change` row holds. */
export type DatedPatch = { readonly effective_from: string; readonly law: JsonObject };

const step = (value: Json | undefined, key: string): Json | undefined =>
	isJsonObject(value)
		? Object.hasOwn(value, key)
			? value[key]
			: undefined
		: Array.isArray(value) && /^\d+$/.test(key)
			? value[Number(key)]
			: undefined;
const at = (value: Json | undefined, path: readonly string[]): Json | undefined =>
	path.reduce(step, value);

/** `held` with the value at `path` under it replaced, or taken away when `value` is null. */
const replaced = (held: Json | undefined, path: readonly string[], value: Json): Json => {
	const [key, ...rest] = path;
	if (key === undefined) return value;
	const last = rest.length === 0;
	if (Array.isArray(held)) {
		const copy: Json[] = [...held];
		if (last && value === null) copy.splice(Number(key), 1);
		else copy[Number(key)] = replaced(copy[Number(key)], rest, value);
		return copy;
	}
	const { [key]: old, ...others } = isJsonObject(held) ? held : {};
	return last && value === null ? others : { ...others, [key]: replaced(old, rest, value) };
};
/** A patch with `value` at `path`; a null stays, because in a patch it takes the value away. */
const patched = (patch: JsonObject, path: readonly string[], value: Json): JsonObject => {
	const [key = '', ...rest] = path;
	const under = patch[key];
	return {
		...patch,
		[key]: rest.length === 0 ? value : patched(isJsonObject(under) ? under : {}, rest, value)
	};
};

/**
 * Turns what a run reported for one family into the finding's patches, one per effective date, deterministically. A
 * law is patched three keys deep (family, row code, field), so a deeper path carries its whole field with the one
 * value changed, read from the law as it stands on that date with the finding's earlier steps: a staged law chains.
 * A value the law already holds on its date, or a patch research already filed, is no change. A change the source
 * does not date is no patch: it is named in `undated` for a person to date. Pure.
 */
export const planChanges = ({
	family,
	chain,
	drafted,
	known,
	reported
}: {
	readonly family: string;
	/** The law's changes in force. */
	readonly chain: readonly Change[];
	/** The patches this finding already holds. */
	readonly drafted: readonly DatedPatch[];
	/** The patches research filed under other findings, whatever their state. */
	readonly known: readonly DatedPatch[];
	readonly reported: readonly ReportedChange[];
}) => {
	const first = chain.map((row) => row.effective_from).toSorted()[0];
	const patches = new Map(drafted.map((row) => [row.effective_from, row.law]));
	const written = new Set<string>();
	const proposed: string[] = [];
	const skipped: string[] = [];
	const undated: string[] = [];
	const dated = (change: ReportedChange) =>
		isDate(change.effective_from) ? change.effective_from : null;
	for (const change of [...reported].toSorted((left, right) =>
		(dated(left) ?? '').localeCompare(dated(right) ?? '')
	)) {
		const row_code = change.row_code == null || change.row_code === '' ? null : change.row_code;
		const whole = change.field_path === WHOLE_ROW;
		const parts = whole ? [] : change.field_path.split('.');
		const path = row_code === null ? parts : [family, row_code, ...parts];
		const label = `${row_code === null ? SETTINGS_FAMILY : family}/${row_code ?? 'settings'}/${change.field_path}`;
		const value = change.new_value ?? null;
		const date = dated(change);
		// undated law stays undated: the research date is never its effective date
		if (date === null) {
			undated.push(`${label}: ${stableJson(value)}${change.notes ? ` (${change.notes})` : ''}`);
			continue;
		}
		const state = inForce(
			[
				...chain,
				...[...patches].map(([effective_from, patch]) => ({
					id: `drafted/${effective_from}`,
					effective_from,
					patch
				}))
			],
			date,
			LAW_DEPTH
		).state;
		const current = at(state, path);
		const fits =
			// a patch runs forward from the law's first change, never before it
			first !== undefined &&
			date > first &&
			path.length >= 2 &&
			!path.some((part) => part === '' || UNSAFE.has(part)) &&
			(row_code === null
				? BLOCKS.includes(path[0] ?? '')
				: LAW_ROWS.some((rows) => rows === family) &&
					(whole
						? // a row is added or removed whole; the chain takes field changes only
							family !== 'subtotal' &&
							(value === null
								? current !== undefined
								: current === undefined && isJsonObject(value))
						: !PROTECTED.has(parts[0] ?? '') && at(state, [family, row_code]) !== undefined));
		if (!fits || (!whole && stableJson(current ?? null) === stableJson(value))) {
			skipped.push(label);
			continue;
		}
		const leaf = path.slice(0, LAW_DEPTH);
		const set: Json =
			whole && isJsonObject(value)
				? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'code'))
				: path.length > LAW_DEPTH
					? replaced(at(state, leaf), path.slice(LAW_DEPTH), value)
					: value;
		if (
			known.some((other) => {
				const filed = at(other.law, leaf);
				return (
					other.effective_from === date &&
					filed !== undefined &&
					stableJson(filed) === stableJson(set)
				);
			})
		) {
			skipped.push(label);
			continue;
		}
		patches.set(date, patched(patches.get(date) ?? {}, leaf, set));
		written.add(date);
		proposed.push(`${label}@${date}`);
	}
	return {
		planned: [...patches].flatMap(([effective_from, law]): readonly DatedPatch[] =>
			written.has(effective_from) ? [{ effective_from, law }] : []
		),
		proposed,
		skipped,
		undated
	};
};
