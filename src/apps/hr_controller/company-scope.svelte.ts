/**
 * Live companies prefix for the HR Controller group.
 *
 * Apps read it for options and defaults; each app owns its chosen id locally.
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

export const companies = (): ReadonlyArray<CompanyScopeRow> => companiesQuery.current ?? [];

export const companiesUnknown = (): boolean =>
	companiesQuery.loading && companiesQuery.current === undefined;

export const companiesError = (): Error | undefined =>
	companiesQuery.current === undefined ? companiesQuery.error : undefined;

export const companiesKnown = (): boolean => companies().length > 0;

export function resolveCompanyId(selectedId: string | null): string | null {
	const rows = companies();
	if (selectedId != null && rows.some((company) => String(company.id) === selectedId)) {
		return selectedId;
	}
	const first = rows[0];
	return first === undefined ? null : String(first.id);
}

export function companyById(id: string | null): CompanyScopeRow | null {
	if (id == null) return null;
	return companies().find((company) => String(company.id) === id) ?? null;
}

export function companyOptions(): { value: string; label: string; description?: string }[] {
	return companies().map((company) => ({
		value: String(company.id),
		label: company.name ?? String(company.id),
		...(company.registration_number != null && company.registration_number !== ''
			? { description: String(company.registration_number) }
			: {})
	}));
}
