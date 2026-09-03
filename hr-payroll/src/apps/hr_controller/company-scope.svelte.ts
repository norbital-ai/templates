/**
 * Single active legal entity for the HR Controller group.
 *
 * The live companies prefix lives here. Apps read it; Entities writes the choice.
 * Default is the first in-force row — computed, never copied into state.
 */
import { client } from '../../lib/workspace-client.js';
import type { WorkspaceRow } from '$bolt/types.js';
import { todayInstant } from '../../lib/ui/calendar.js';

export type CompanyScopeRow = WorkspaceRow<'companies'>;

const companiesQuery = client.db.companies.findMany({
	where: {
		approval_id: { isNull: true },
		effective_range: { contains_date: todayInstant() }
	},
	orderBy: { name: 'asc' },
	limit: 500
});

let selectedId = $state<string | null>(null);

export const companies = (): ReadonlyArray<CompanyScopeRow> => companiesQuery.current ?? [];

export const companiesUnknown = (): boolean =>
	companiesQuery.loading && companiesQuery.current === undefined;

export const companiesError = (): Error | undefined =>
	companiesQuery.current === undefined ? companiesQuery.error : undefined;

export const activeCompanyId = (): string | null => {
	const rows = companies();
	if (selectedId != null && rows.some((company) => String(company.id) === selectedId)) {
		return selectedId;
	}
	const first = rows[0];
	return first === undefined ? null : String(first.id);
};

export const activeCompany = (): CompanyScopeRow | null => {
	const id = activeCompanyId();
	return companies().find((company) => String(company.id) === id) ?? null;
};

export const companiesKnown = (): boolean => companies().length > 0;

export const selectCompany = (id: string): void => {
	selectedId = id;
};
