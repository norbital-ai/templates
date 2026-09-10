/**
 * The Settings app's scope: which law, and which version of it.
 *
 * Those are two questions and the header used to collapse them into one. The combobox listed
 * lineage codes (MY, SG, …) and the page then silently picked the version in force today — so the
 * snapshot actually being read was never named, never selectable, and the older and newer versions
 * of the same law were invisible from the control that was supposedly scoping them.
 *
 * The scope is a grouped list now. A group is a lineage — the country code and the name its
 * newest version carries — and its options are that lineage's versions, each identified by its
 * snapshot id `<code>_<rolling index>` (`MY_1`, `MY_2`, …) with its effective range as the
 * description and its state badge. Only a version is an option: a lineage is a family of snapshots,
 * and "the MY settings" is not a thing the page can show.
 */
import { client } from '../../lib/workspace-client.js';
import type { TenantI18nKeys } from '$bolt/i18n-keys';
import type { WorkspaceRow } from '$bolt/types.js';
import { formatSettingsRange } from '../../lib/ui/display-formatters.js';
import { coversDay, isInForceCandidate, newestFirst } from '../../lib/jurisdiction_settings.js';
import { todayKey } from '../../lib/ui/calendar.js';

type JurisdictionScopeRow = Pick<
	WorkspaceRow<'jurisdiction_settings'>,
	'id' | 'code' | 'name' | 'effective_range' | 'sealed_at' | 'voided_at'
>;

/** What a selected node carries back to the page, so it never re-reads the tree to find it. */
type JurisdictionScopeNode = Readonly<{ code: string; versionId: string | null }>;

const versionsQuery = client.db.jurisdiction_settings.findMany({
	where: { approval_id: { isNull: true } },
	orderBy: { code: 'asc' },
	columns: {
		id: true,
		code: true,
		name: true,
		effective_range: true,
		sealed_at: true,
		voided_at: true
	},
	limit: 2_000
});

const versions = (): ReadonlyArray<JurisdictionScopeRow> => versionsQuery.current ?? [];

export const jurisdictionsUnknown = (): boolean =>
	versionsQuery.loading && versionsQuery.current === undefined;

export const jurisdictionsError = (): Error | undefined =>
	versionsQuery.current === undefined ? versionsQuery.error : undefined;

/** Every version of every lineage, newest first within each, keyed by code and sorted by code. */
function lineages(): ReadonlyArray<readonly [string, JurisdictionScopeRow[]]> {
	const byCode = Map.groupBy(
		versions().filter((row) => row.code != null && row.code !== ''),
		(row) => row.code!
	);
	return [...byCode.entries()]
		.toSorted(([left], [right]) => left.localeCompare(right))
		.map(([code, rows]) => [code, newestFirst(rows)] as const);
}

/** The version of a lineage in force today, else its newest. The page's default selection. */
function defaultVersionOf(rows: readonly JurisdictionScopeRow[]): JurisdictionScopeRow | undefined {
	const today = todayKey();
	return (
		rows.find((row) => isInForceCandidate(row) && coversDay(row.effective_range, today)) ?? rows[0]
	);
}

/**
 * The chosen version id if it still exists, else the first lineage's default. Null only when the
 * workspace holds no settings at all.
 */
export function resolveJurisdictionScope(
	selectedVersionId: string | null
): JurisdictionScopeNode | null {
	const all = lineages();
	if (selectedVersionId != null) {
		for (const [code, rows] of all) {
			if (rows.some((row) => row.id === selectedVersionId))
				return { code, versionId: selectedVersionId };
		}
	}
	const first = all[0];
	if (first === undefined) return null;
	return { code: first[0], versionId: defaultVersionOf(first[1])?.id ?? null };
}

/**
 * The snapshot id of the row at `offset` in a lineage's newest-first version list: `<code>_<index>`
 * counts from the oldest, so `MY_1` is the first version the lineage ever sealed and a successor
 * extends the roll without renumbering an identifier an operator already saw.
 */
export const snapshotId = (code: string, rows: readonly unknown[], offset: number): string =>
	`${code}_${rows.length - offset}`;

/**
 * The grouped options the header's combobox lists: one group per lineage, one option per version,
 * newest first, the badge naming the version's state so the one in force reads at a glance.
 *
 * A version is identified by its snapshot id, `<code>_<rolling index>` — `MY_1` is the first
 * version the lineage ever sealed and the index rolls forward with each successor — with its
 * effective range beside it: the id names the snapshot, the range says when it was the law.
 */
export function jurisdictionOptions(): ReadonlyArray<{
	readonly value: string;
	readonly label: string;
	readonly description: string;
	readonly type: string;
	readonly icon: string;
	readonly badge: TenantI18nKeys | null;
	readonly search_term: string;
}> {
	const today = todayKey();
	return lineages().flatMap(([code, rows]) =>
		rows.map((row, offset) => {
			const inForce = isInForceCandidate(row) && coversDay(row.effective_range, today);
			const state: readonly [string, TenantI18nKeys | null] =
				row.voided_at != null
					? ['lucide:circle-slash', 'app.settings.version_voided']
					: inForce
						? ['lucide:circle-check', 'app.settings.version_in_force']
						: row.sealed_at != null
							? ['lucide:lock', 'app.settings.version_sealed']
							: ['lucide:pencil', 'app.settings.version_draft'];
			const snapshot = snapshotId(code, rows, offset);
			const range = formatSettingsRange(row.effective_range);
			return {
				value: row.id,
				label: snapshot,
				description: range,
				type: `${rows[0]?.name ?? code} · ${code}`,
				icon: state[0],
				badge: state[1],
				search_term: `${snapshot} ${code} ${rows[0]?.name ?? ''} ${range}`
			};
		})
	);
}
