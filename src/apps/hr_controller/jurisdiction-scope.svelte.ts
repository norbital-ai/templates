/**
 * Live jurisdiction lineage prefix for the Settings app.
 *
 * Settings is scoped by jurisdiction settings lineage (`code`: MY, SG, …), not by legal
 * entity: one lineage is shared by every entity bound to it through `companies.settings_code`.
 * Apps read it for options and defaults; Settings owns its chosen code locally.
 */
import { client } from '../../lib/workspace-client.js';
import type { WorkspaceRow } from '$bolt/types.js';

type JurisdictionScopeRow = Pick<WorkspaceRow<'jurisdiction_settings'>, 'code' | 'name'>;

const lineagesQuery = client.db.jurisdiction_settings.findMany({
	where: { approval_id: { isNull: true } },
	orderBy: { code: 'asc' },
	columns: { code: true, name: true },
	limit: 500
});

const lineages = (): ReadonlyArray<JurisdictionScopeRow> => lineagesQuery.current ?? [];

export const jurisdictionsUnknown = (): boolean =>
	lineagesQuery.loading && lineagesQuery.current === undefined;

export const jurisdictionsError = (): Error | undefined =>
	lineagesQuery.current === undefined ? lineagesQuery.error : undefined;

/** Distinct lineage codes, keeping the latest row's name for the label. */
function jurisdictionCodes(): string[] {
	const seen = new Map<string, JurisdictionScopeRow>();
	for (const row of lineages()) {
		if (row.code != null && row.code !== '') seen.set(row.code, row);
	}
	return [...seen.keys()].toSorted((left, right) => left.localeCompare(right));
}

export function resolveJurisdictionCode(selectedCode: string | null): string | null {
	const codes = jurisdictionCodes();
	if (selectedCode != null && codes.includes(selectedCode)) return selectedCode;
	return codes[0] ?? null;
}

export function jurisdictionOptions(): { value: string; label: string; description?: string }[] {
	const latestByCode = new Map<string, JurisdictionScopeRow>();
	for (const row of lineages()) {
		if (row.code != null && row.code !== '') latestByCode.set(row.code, row);
	}
	return [...latestByCode.entries()]
		.toSorted(([left], [right]) => left.localeCompare(right))
		.map(([code, row]) => ({
			value: code,
			label: row.name ?? code,
			...(row.name != null && row.name !== '' && row.name !== code ? { description: code } : {})
		}));
}
