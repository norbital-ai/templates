/**
 * L-TPL-hr-payroll-009 / 010: settings lineage over `effective_range`, via `@norbital-ai/std/versioned`.
 * A correction is a cloned draft sealed over the previous version; a sealed row only shortens or voids.
 */
import type { ActInput, Id, Insert } from '@norbital-ai/bolt';
import { onlyShortens, sealWrites, voidOnce, type Lineage } from '@norbital-ai/std/versioned';
import { Instant, PlainDate, type DatePeriod } from '@norbital-ai/std/date';

/** The columns `sealWrites` / `voidOnce` read, named as this model stores them. */
export type SettingsLineage = {
	readonly id: Id<'jurisdiction_settings'>;
	readonly effective_range: DatePeriod;
	readonly sealed_at?: Instant | string | null;
	readonly voided_at?: Instant | string | null;
	readonly void_reason?: string | null;
};

const SETTINGS_WRITE_FIELDS = [
	'code',
	'jurisdiction_code',
	'name',
	'employee_input_schema',
	'entity_input_schema',
	'behaviours',
	'sealed_at',
	'voided_at',
	'void_reason',
	'payroll',
	'change_summary',
	'effective_range',
	'sources',
	'reference_tables',
	'cloned_from_id'
] as const;

export const SETTINGS_DIFF_FIELDS = [
	'name',
	'jurisdiction_code',
	'payroll',
	'sources',
	'behaviours',
	'employee_input_schema',
	'entity_input_schema',
	'reference_tables',
	'change_summary',
	'effective_range'
] as const;

export type SettingsDiffLine = {
	readonly path: string;
	readonly kind: 'added' | 'removed' | 'changed';
	readonly left?: unknown;
	readonly right?: unknown;
};

function asLineage(row: SettingsLineage): Lineage & { readonly id: Id<'jurisdiction_settings'> } {
	return {
		id: row.id,
		period: row.effective_range,
		sealed_at: row.sealed_at ?? null,
		voided_at: row.voided_at ?? null,
		void_reason: row.void_reason ?? null
	};
}

type SettingsUpdate = Extract<ActInput<'jurisdiction_settings.update'>, readonly unknown[]>;

/** One `jurisdiction_settings.update` list: shorten the predecessor, seal the draft. */
export function sealSettings(
	draft: SettingsLineage,
	siblings: readonly SettingsLineage[],
	now: Instant
): SettingsUpdate {
	return sealWrites(asLineage(draft), siblings.map(asLineage), now).map((write) => ({
		target: write.target,
		set: {
			effective_range: write.set.period,
			...(write.set.sealed_at == null ? {} : { sealed_at: Instant(write.set.sealed_at) })
		}
	}));
}

/** Null when the update is admitted; otherwise the refusal. */
export function refuseSealedUpdate(
	before: SettingsLineage,
	set: { readonly [field: string]: unknown }
): string | null {
	const lineage = asLineage(before);
	const { effective_range, ...rest } = set;
	const input = effective_range === undefined ? set : { ...rest, period: effective_range };
	return (
		voidOnce(lineage, input) ?? (lineage.sealed_at != null ? onlyShortens(lineage, input) : null)
	);
}

type SettingsWrite = Pick<
	Insert<'jurisdiction_settings'>,
	Extract<(typeof SETTINGS_WRITE_FIELDS)[number], keyof Insert<'jurisdiction_settings'>>
>;

/** Create input of the successor draft: same lineage, open, unsealed, `cloned_from_id` set. */
export function cloneSettingsFields(
	version: SettingsLineage & SettingsWrite,
	from: DatePeriod['from'] | string
): Insert<'jurisdiction_settings'> {
	return {
		code: version.code,
		jurisdiction_code: version.jurisdiction_code,
		name: version.name,
		payroll: version.payroll,
		sources: version.sources,
		effective_range: { from: PlainDate(from), to: null },
		cloned_from_id: version.id,
		sealed_at: null,
		voided_at: null,
		void_reason: null,
		...(version.employee_input_schema === undefined
			? {}
			: { employee_input_schema: version.employee_input_schema }),
		...(version.entity_input_schema === undefined
			? {}
			: { entity_input_schema: version.entity_input_schema }),
		...(version.behaviours === undefined ? {} : { behaviours: version.behaviours }),
		...(version.change_summary === undefined ? {} : { change_summary: version.change_summary }),
		...(version.reference_tables === undefined
			? {}
			: { reference_tables: version.reference_tables })
	};
}

/** A row narrowed to the columns a nested create declares. Dynamic pick cannot construct `Pick` without an assertion. */
export function stripRow<T extends object, const K extends readonly (string & keyof T)[]>(
	row: T,
	columns: K
): Pick<T, K[number]> {
	const out = {} as Pick<T, K[number]>;
	for (const column of columns) {
		if (row[column] !== undefined) out[column] = row[column];
	}
	return out;
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/** L-TPL-hr-payroll-010: field-level diff of two settings snapshots. */
export function diffSettings(
	left: { readonly [field: string]: unknown },
	right: { readonly [field: string]: unknown },
	fields: readonly string[] = SETTINGS_DIFF_FIELDS
): SettingsDiffLine[] {
	const out: SettingsDiffLine[] = [];
	for (const field of fields) {
		const a = left[field];
		const b = right[field];
		if (same(a, b)) continue;
		if (a === undefined || a === null) out.push({ path: field, kind: 'added', right: b });
		else if (b === undefined || b === null) out.push({ path: field, kind: 'removed', left: a });
		else out.push({ path: field, kind: 'changed', left: a, right: b });
	}
	return out;
}

export function diffCatalogCodes(
	left: readonly string[],
	right: readonly string[],
	path: string
): SettingsDiffLine[] {
	const a = new Set(left);
	const b = new Set(right);
	const out: SettingsDiffLine[] = [];
	for (const code of [...a].sort()) {
		if (!b.has(code)) out.push({ path: `${path}.${code}`, kind: 'removed', left: code });
	}
	for (const code of [...b].sort()) {
		if (!a.has(code)) out.push({ path: `${path}.${code}`, kind: 'added', right: code });
	}
	return out;
}
