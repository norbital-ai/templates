/** The board's searchable copy of a job: its own title plus the site's name and code. */
export const searchTextFor = (
	title: string,
	site:
		| {
				readonly name: string;
				readonly site_code?: string | null;
		  }
		| undefined
): string => [title, site?.name, site?.site_code].filter((part) => part != null).join(', ');
/**
 * What filing a job stamps on it: unassigned until somebody holds it, dispatched the moment somebody does, and the
 * search copy. `job_assignments`' create callback runs it for every job filed, a job nested under its site included.
 */
export const dispatchFacts = <T>(
	job: {
		readonly title?: string | undefined;
		readonly assignee_user_id?: string | null | undefined;
		readonly status?: 'unassigned' | 'assigned' | 'completed' | null | undefined;
		readonly dispatched_at?: T | null | undefined;
	},
	site:
		| {
				readonly name: string;
				readonly site_code?: string | null;
		  }
		| undefined,
	now: T
) => {
	const holder = job.assignee_user_id != null;
	return {
		status: job.status ?? (holder ? 'assigned' : 'unassigned'),
		dispatched_at: job.dispatched_at ?? (holder ? now : null),
		search_text: searchTextFor(job.title ?? '', site)
	};
};
