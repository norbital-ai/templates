import type { JsonObject } from './contracts.js';
import { isDynObject, stableJson, type Json } from './foundation.js';
import {
	hostOf,
	instrumentKey,
	officialSource,
	SETTINGS_FAMILY,
	valueAt,
	WHOLE_ROW
} from './statutory_change.js';

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
		'Jurisdiction-wide values and shapes: `lookup` constants, rounding, currency, tax year, the employee and entity extension schemas.',
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

/** The hosts a version's `references` cite and the ledger does not hold yet, as sources; only official ones start active. */
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

/** A sealed version research can file a change against, with the one family it read. */
export type ResearchVersion = {
	readonly id: string;
	readonly from: string;
	readonly to: string | null;
	readonly settings: JsonObject;
	readonly rows: readonly JsonObject[];
	readonly subtotals: readonly JsonObject[];
};
export type ReportedChange = {
	readonly row_code?: string | null | undefined;
	readonly field_path: string;
	readonly new_value?: Json | null | undefined;
	readonly effective_from?: string | null | undefined;
	readonly notes?: string | null | undefined;
};
export type KnownChange = {
	readonly family: string;
	readonly row_code: string | null;
	readonly field_path: string;
	readonly new_value: Json | null;
	readonly effective_from: string | null;
	/** Rejected or applied: it dedupes a report, but no later step stands on it. */
	readonly settled: boolean;
};
export type PlannedChange = {
	readonly family: string;
	readonly row_code: string | null;
	readonly field_path: string;
	readonly old_value: Json | null;
	readonly new_value: Json | null;
	readonly effective_from: string | null;
	readonly baseline_version_id: string;
	readonly notes: string | null;
};

/** A new row names its subtotals by code; ids belong to one version. */
const bound = (value: Json | null, version: ResearchVersion): Json | null => {
	if (!isDynObject(value)) return value;
	const out: { [key: string]: Json } = {};
	for (const [key, field] of Object.entries(value)) {
		const subtotal =
			key === 'subtotal_id' || key === 'employer_cost_subtotal_id'
				? version.subtotals.find((row) => row.code === field)
				: undefined;
		out[key] = (typeof subtotal?.id === 'string' ? subtotal.id : field) as Json;
	}
	return out;
};

/**
 * Turns what a run reported for one family into ledger rows, deterministically. A value already in the version in force
 * on its date, or sealed for later, is no change; one the ledger holds, in any state, is no second row. Each step reads
 * its `old_value` from the version it lands on and the steps before it there, so a staged law chains. Pure.
 */
export const planChanges = ({
	family,
	versions,
	known,
	reported,
	today
}: {
	readonly family: string;
	readonly versions: readonly ResearchVersion[];
	readonly known: readonly KnownChange[];
	readonly reported: readonly ReportedChange[];
	readonly today: string;
}) => {
	// past the seeded window's end the last version still stands until a change is materialized
	const last = versions.toSorted((left, right) => right.from.localeCompare(left.from))[0];
	const versionOn = (date: string) =>
		versions.find((row) => row.from <= date && (row.to === null || date <= row.to)) ??
		(last !== undefined && date > last.from ? last : undefined);
	const snapshotOf = (version: ResearchVersion) => ({
		settings: version.settings,
		rows: { [family]: version.rows }
	});
	const planned: PlannedChange[] = [];
	const skipped: string[] = [];
	const dated = (change: ReportedChange) =>
		isDate(change.effective_from) ? change.effective_from : null;
	for (const change of [...reported].toSorted((left, right) =>
		(dated(left) ?? '').localeCompare(dated(right) ?? '')
	)) {
		const row_code = change.row_code == null || change.row_code === '' ? null : change.row_code;
		const target = {
			family: row_code === null ? SETTINGS_FAMILY : family,
			row_code,
			field_path: change.field_path
		};
		const effective_from = dated(change);
		const label = `${target.family}/${row_code ?? 'settings'}/${change.field_path}`;
		const version = versionOn(effective_from ?? today);
		if (version === undefined) {
			skipped.push(label);
			continue;
		}
		const new_value =
			change.field_path === WHOLE_ROW
				? bound(change.new_value ?? null, version)
				: (change.new_value ?? null);
		const samePath = (other: {
			readonly family: string;
			readonly row_code: string | null;
			readonly field_path: string;
		}) =>
			other.family === target.family &&
			other.row_code === row_code &&
			other.field_path === change.field_path;
		const value = stableJson(new_value);
		const scheduled = versions.filter((row) => row.from > version.from);
		const held =
			stableJson(valueAt(snapshotOf(version), target)) === value ||
			(effective_from === null &&
				scheduled.some((row) => stableJson(valueAt(snapshotOf(row), target)) === value)) ||
			[...known, ...planned].some(
				(other) =>
					samePath(other) &&
					stableJson(other.new_value) === value &&
					(effective_from === null || other.effective_from === effective_from)
			);
		if (held) {
			skipped.push(label);
			continue;
		}
		const earlier = [...known.filter((other) => !other.settled), ...planned]
			.filter(
				(other) =>
					samePath(other) &&
					effective_from !== null &&
					other.effective_from !== null &&
					other.effective_from < effective_from &&
					versionOn(other.effective_from)?.id === version.id
			)
			.toSorted((left, right) =>
				String(right.effective_from).localeCompare(String(left.effective_from))
			)[0];
		planned.push({
			...target,
			old_value:
				earlier === undefined ? valueAt(snapshotOf(version), target) : (earlier.new_value ?? null),
			new_value,
			// undated law stays undated: the research date is never its effective date
			effective_from,
			baseline_version_id: version.id,
			notes: change.notes ?? null
		});
	}
	return { planned: planned as readonly PlannedChange[], skipped };
};
