/** The board's searchable copy of a job: its own title plus the site's name and code. */
export const searchTextFor = (
	title: string,
	site: { readonly name: string; readonly site_code?: string | null } | undefined
): string => [title, site?.name, site?.site_code].filter((part) => part != null).join(', ');

/**
 * What filing a job stamps on it: unassigned until somebody holds it, dispatched the moment somebody does, and the
 * search copy. A job is filed through `job_assignments` and nested under its site, and a nested create runs only the
 * parent's transform, so both transforms use this.
 */
export const dispatchFacts = <T>(
	job: {
		readonly title?: string | undefined;
		readonly assignee_user_id?: unknown;
		readonly status?: 'unassigned' | 'assigned' | 'completed' | null | undefined;
		readonly dispatched_at?: T | null | undefined;
	},
	site: { readonly name: string; readonly site_code?: string | null } | undefined,
	now: T
) => {
	const holder = job.assignee_user_id != null;
	return {
		status: job.status ?? (holder ? 'assigned' : 'unassigned'),
		dispatched_at: job.dispatched_at ?? (holder ? now : null),
		search_text: searchTextFor(job.title ?? '', site)
	};
};
