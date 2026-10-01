/**
 * Text fields whose valid values are stored configuration: a code of a version's `reference_rows`
 * table, or a key of its wage order. One judgement each, shared by the writes (some sealed version
 * of the lineage admits the value), the facts-owed list and the run's precheck (the governing
 * version admits it). The value stays text; nothing here names a jurisdiction.
 */
import type { TransformCtx } from '@norbital-ai/bolt';
import type { CodeResolver, FactKey } from './datatypes/fact_keys.js';
import { wagePlaces, wageRegions, wageSectors, type WageKeySource } from './datatypes/wages.js';

/**
 * Model fields whose value is a code of the version's table of this name. A lineage whose versions
 * declare no such table admits only an empty value. `jurisdiction_holidays.religion` is a comma
 * list: each part is a code.
 */
export const CODED_FIELDS = {
	employees: { race: 'RACE', religion: 'RELIGION' },
	companies: { risk_class: 'RISK_CLASS' },
	jurisdiction_holidays: { religion: 'RELIGION' }
} as const;

type Db = TransformCtx<'employments'>['db'];

/** What a coded judgement reads of a version: its id and lineage, its table declarations, its wage order. */
export type CodedVersion = {
	readonly id: string;
	readonly code: string;
	readonly tables?: readonly { readonly name: string }[] | null | undefined;
	readonly work_rules?: { readonly wages?: WageKeySource | null | undefined } | null | undefined;
};

/** The tables a list of declarations' `code` inputs name. */
export const factTables = (declarations: readonly object[]): string[] => [
	...new Set(
		(declarations as readonly FactKey[]).flatMap((field) =>
			field.type === 'code' && field.table != null ? [field.table] : []
		)
	)
];

/**
 * A write's resolver per lineage: a code of the table one of the lineage's `versions` carries on
 * some day. The write admits what some version admits; the version governing a date decides at
 * the run (`referenceCodes`).
 */
export async function lineageCodes(
	db: Db,
	versions: readonly Pick<CodedVersion, 'id' | 'code'>[],
	tables: readonly string[]
): Promise<(lineage: string) => CodeResolver> {
	const rows =
		versions.length === 0 || tables.length === 0
			? []
			: (
					await db.read('reference_rows', {
						where: {
							settings_id: { in: versions.map((version) => version.id) as never },
							table: { in: [...tables] }
						},
						select: { settings_id: true, table: true, code: true, parent_code: true },
						all: true
					})
				).rows;
	const lineageOf = new Map(versions.map((version) => [String(version.id), version.code]));
	return (lineage) => (table, code) => {
		const row = rows.find(
			(candidate) =>
				candidate.table === table &&
				candidate.code === code &&
				lineageOf.get(String(candidate.settings_id)) === lineage
		);
		return row == null ? null : { parent_code: row.parent_code ?? null };
	};
}

/**
 * One coded value against `versions`' `table`: empty is no code; versions that declare no such
 * table admit only empty; else each code (each part of a comma `list`) must resolve. The refusal,
 * naming the value, or null.
 */
export function codedFieldFault(
	scope: string,
	field: string,
	table: string,
	value: string | null | undefined,
	versions: readonly Pick<CodedVersion, 'tables'>[],
	codes: CodeResolver,
	list = false
): string | null {
	const parts = (list ? (value ?? '').split(',') : [value ?? ''])
		.map((part) => part.trim())
		.filter((part) => part !== '');
	if (parts.length === 0) return null;
	if (!versions.some((version) => (version.tables ?? []).some((row) => row.name === table)))
		return `${scope} declares no ${table} codes, so ${field} must be empty.`;
	const bad = parts.find((part) => codes(table, part) == null);
	return bad == null ? null : `${scope}: ${field} ${bad} is not a ${table} code.`;
}

/** Which keys of a wage order a field names. `sites` is a worksite's region: a place or a region. */
export type WageKeys = 'places' | 'sectors' | 'regions' | 'sites';

/** The keys of one kind a wage order names. */
export const wageKeys = (wages: WageKeySource | null | undefined, kind: WageKeys): string[] =>
	kind === 'places'
		? wagePlaces(wages)
		: kind === 'sectors'
			? wageSectors(wages)
			: kind === 'regions'
				? wageRegions(wages)
				: [...new Set([...wagePlaces(wages), ...wageRegions(wages)])];

/** Whether one wage order admits `value` as a key of `kind`: listed, or a sector its code pattern matches. */
const wageAdmits = (
	wages: WageKeySource | null | undefined,
	kind: WageKeys,
	value: string
): boolean =>
	wageKeys(wages, kind).includes(value) ||
	(kind === 'sectors' &&
		wages?.sector_code_pattern != null &&
		new RegExp(wages.sector_code_pattern).test(value));

/**
 * One wage-keyed value against some of `orders`: empty is no key; orders that name no key of
 * `kind` admit only empty. The refusal, naming the value, or null.
 */
export function wageKeyFault(
	scope: string,
	field: string,
	kind: WageKeys,
	value: string | null | undefined,
	orders: readonly (WageKeySource | null | undefined)[]
): string | null {
	const site = (value ?? '').trim();
	if (site === '' || orders.some((wages) => wageAdmits(wages, kind, site))) return null;
	const noun = kind === 'sectors' ? 'sector' : kind === 'regions' ? 'region' : 'place';
	return orders.every((wages) => wageKeys(wages, kind).length === 0)
		? `${scope}'s wage order names no wage ${noun}, so ${field} must be empty.`
		: `${scope}: ${field} ${site} is not a wage ${noun} of its wage order.`;
}

/**
 * `companies.region` is refused only where the wage order is keyed by region: a workplace-keyed
 * order reads the worksite and keeps the region as a fallback.
 */
export const companyRegionFault = (
	scope: string,
	value: string | null | undefined,
	orders: readonly (WageKeySource | null | undefined)[]
): string | null =>
	orders.some((wages) => wages?.workplace_keyed === true)
		? null
		: wageKeyFault(scope, 'region', 'regions', value, orders);
