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
 * What filing a job stamps on it: pending until completed, dispatched the moment a contractor is linked, and the
 * search copy. `job_assignments`' create callback runs it for every job filed, a job nested under its site included.
 */
export const dispatchFacts = <T>(
	job: {
		readonly title?: string | undefined;
		readonly assignee_user_id?: string | null | undefined;
		readonly status?: 'pending' | 'completed' | null | undefined;
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
		status: job.status ?? 'pending',
		dispatched_at: job.dispatched_at ?? (holder ? now : null),
		search_text: searchTextFor(job.title ?? '', site)
	};
};
/**
 * The keys a contractor's email or phone number matches a member by: a lower-cased email, or the phone's digits with
 * and without Singapore's 65 (an 8-digit local number and its +65 form are one member, as `sys_user.phone_key` stores
 * whichever was entered).
 */
export const contactKeys = (contact: string | null | undefined): readonly string[] => {
	const value = contact?.trim() ?? '';
	if (value === '') return [];
	if (value.includes('@')) return [value.toLowerCase()];
	const digits = value.replace(/\D/g, '');
	if (digits.length === 8) return [digits, `65${digits}`];
	if (digits.length === 10 && digits.startsWith('65')) return [digits, digits.slice(2)];
	return digits === '' ? [] : [digits];
};
/** The member a contact names, by `contactKeys`; none when no member or more than one matches. */
export const memberByContact = <I extends string>(
	members: readonly {
		readonly id: I;
		readonly email: string | null;
		readonly phone: string | null;
	}[],
	contact: string | null | undefined
): I | null => {
	const keys = new Set(contactKeys(contact));
	if (keys.size === 0) return null;
	const found = members.filter((member) =>
		[...contactKeys(member.email), ...contactKeys(member.phone)].some((key) => keys.has(key))
	);
	return found.length === 1 ? found[0]!.id : null;
};
