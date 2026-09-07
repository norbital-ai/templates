/**
 * The Settings app's scope: which law, and which version of it.
 *
 * Those are two questions and the header used to collapse them into one. The combobox listed
 * lineage codes (MY, SG, …) and the page then silently picked the version in force today — so the
 * snapshot actually being read was never named, never selectable, and the older and newer versions
 * of the same law were invisible from the control that was supposedly scoping them.
 *
 * The scope is a tree now. A root is a lineage — the country code and the name its newest version
 * carries — and its children are that lineage's versions, each labelled by the range it is the law
 * across, which is a version's whole identity. Only a version is selectable: a lineage is a family
 * of snapshots, and "the MY settings" is not a thing the page can show.
 */
import { client } from '../../lib/workspace-client.js';
import type { WorkspaceRow } from '$bolt/types.js';
import { formatEffectiveRange } from '../../lib/ui/display-formatters.js';
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
	const byCode = new Map<string, JurisdictionScopeRow[]>();
	for (const row of versions()) {
		if (row.code == null || row.code === '') continue;
		const bucket = byCode.get(row.code);
		if (bucket === undefined) byCode.set(row.code, [row]);
		else bucket.push(row);
	}
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

/** The two-level tree the header's combobox draws. Lineage ids are prefixed so they cannot collide
 * with a version's uuid, and every one of them is handed back as a disabled id: a lineage is a
 * family of snapshots, and selecting the family would not name a law. */
export function jurisdictionTree(): {
	readonly rootItems: {
		id: string;
		title: string;
		icon: string;
		searchText: string;
		metadata: null;
		children: { id: string; title: string; icon: string; searchText: string; metadata: null }[];
	}[];
	readonly disabledIds: string[];
} {
	const today = todayKey();
	const rootItems = lineages().map(([code, rows]) => ({
		id: `lineage:${code}`,
		title: `${rows[0]?.name ?? code} · ${code}`,
		icon: 'lucide:landmark',
		searchText: `${code} ${rows[0]?.name ?? ''}`,
		metadata: null,
		children: rows.map((row) => ({
			id: row.id,
			title: formatEffectiveRange(row.effective_range),
			icon:
				row.voided_at != null
					? 'lucide:circle-slash'
					: isInForceCandidate(row) && coversDay(row.effective_range, today)
						? 'lucide:circle-check'
						: row.sealed_at != null
							? 'lucide:lock'
							: 'lucide:pencil',
			searchText: `${code} ${formatEffectiveRange(row.effective_range)}`,
			metadata: null
		}))
	}));
	return { rootItems, disabledIds: rootItems.map((item) => item.id) };
}
