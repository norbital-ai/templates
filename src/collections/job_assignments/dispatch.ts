import type { Row } from './$types.js';

/** What a filed job says about its own dispatch; the rest of the row is not read here. */
export type FiledJob = Pick<Row, 'title'> &
	Partial<Pick<Row, 'assignee_user_id' | 'status' | 'dispatched_at'>>;

type SiteWords = { readonly name: string; readonly site_code?: string | null };

/** The board's searchable copy of a job: its own title plus the site's name and code. */
export const searchTextFor = (title: string, site: SiteWords | undefined): string =>
	[title, site?.name, site?.site_code].filter((part) => part != null).join(', ');

/**
 * What filing a job stamps on it: unassigned until a contractor is named, dispatched the moment
 * one is, and the search copy derived last so a caller cannot forge or stale it.
 *
 * Shared because a job is filed two ways — through `job_assignments` itself, and nested under the
 * site it names — and a nested create does not run this collection's transform.
 */
export const dispatchFacts = (job: FiledJob, site: SiteWords | undefined, now: string) => {
	const assignee = job.assignee_user_id ?? null;
	return {
		status: job.status ?? (assignee === null ? ('unassigned' as const) : ('assigned' as const)),
		dispatched_at: job.dispatched_at ?? (assignee === null ? null : now),
		search_text: searchTextFor(job.title, site)
	};
};
