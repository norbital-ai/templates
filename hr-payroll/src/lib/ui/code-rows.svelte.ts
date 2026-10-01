import { bolt } from '$bolt';
import type { CodedVersion } from '../coded-fields.js';
import { coversDate } from '../payroll/run/effective.js';
import type { IsoDate } from '../payroll/run/dates.js';
import { settingsInForce } from '../jurisdiction_settings.js';
import type { Wire } from '../wire.js';
import { liveRows } from './live.svelte.js';
import { inForceSettings } from './settings-scope.js';

/** One option row of a version's table, as a select shows it. */
export type CodeRow = {
	readonly table: string;
	readonly code: string;
	readonly parent_code: string | null;
	readonly label: string | null;
	readonly effective_range: unknown;
};

type BaseVersion = Parameters<typeof settingsInForce>[0][number] & {
	readonly id: string;
	readonly tables?: CodedVersion['tables'];
};

/**
 * The lineage's sealed version in force on a day, reading the version columns `select` names beside
 * its identity and `tables` (whole version rows run to megabytes). Must be called during component
 * initialisation.
 */
export function versionInForce<V extends object = object>(
	code: () => string | null | undefined,
	day: () => string,
	select: () => Readonly<Record<string, true>> = () => ({})
) {
	const versions = liveRows<BaseVersion & V>(() => {
		const lineage = code();
		return lineage
			? (bolt.read('jurisdiction_settings', {
					where: inForceSettings(lineage, day()),
					select: {
						id: true,
						code: true,
						name: true,
						sealed_at: true,
						voided_at: true,
						approval_id: true,
						effective_range: true,
						tables: true,
						...select()
					} as never,
					all: true
				}) as never)
			: null;
	});
	return {
		get current(): Wire<BaseVersion & V> | null {
			return settingsInForce(versions.current ?? [], code() ?? '', day());
		}
	};
}

/**
 * A version's `reference_rows` of `tables`: every row (`current`, for `referenceCodes`) and the rows
 * in force on `day`. Must be called during component initialisation.
 */
export function codeRows(
	version: () => { readonly id: string } | null | undefined,
	tables: () => readonly string[],
	day: () => string
) {
	const rows = liveRows<CodeRow>(() => {
		const settings = version();
		const names = tables();
		return settings == null || names.length === 0
			? null
			: bolt.read('reference_rows', {
					where: { settings_id: { eq: settings.id }, table: { in: [...names] } } as never,
					select: {
						table: true,
						code: true,
						parent_code: true,
						label: true,
						effective_range: true
					},
					all: true
				});
	});
	return {
		get current(): readonly CodeRow[] | undefined {
			return rows.current;
		},
		get inForce(): readonly CodeRow[] {
			return (rows.current ?? []).filter((row) =>
				coversDate(row.effective_range, day().slice(0, 10) as IsoDate)
			);
		}
	};
}
