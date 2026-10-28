/**
 * What filing a job stamps on it: pending until completed, and dispatched the moment a contractor is linked.
 * `job_assignments`' create callback runs it for every job filed, a job nested under its site included.
 */
export const dispatchFacts = <T>(
	job: {
		readonly assignee_user_id?: string | null | undefined;
		readonly status?: 'pending' | 'completed' | null | undefined;
		readonly dispatched_at?: T | null | undefined;
	},
	now: T
) => ({
	status: job.status ?? 'pending',
	dispatched_at: job.dispatched_at ?? (job.assignee_user_id != null ? now : null)
});
/**
 * The keys a contractor's email or phone number matches a member by: a lower-cased email, or the phone's digits with
 * and without Singapore's 65 (an 8-digit local number and its +65 form are one member, as `sys_user.phone_key` stores
 * whichever was entered).
 */
const contactKeys = (contact: string | null | undefined): readonly string[] => {
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
/** A WhatsApp identity: a phone number's JID, or a group, linked-device, broadcast or channel one. */
const JID = /@(?:s\.whatsapp\.net|c\.us|g\.us|lid|broadcast|newsletter)$/;
/**
 * Who a message or photo came from, as a person reads it: the member it names (by member id, or by the phone or email
 * it carries, `contactKeys`), else an unmatched phone JID's number, else the provider's display name. Another JID or a
 * member id nobody reads is no name: `null`.
 */
export const senderName = (
	sender: string,
	members: readonly {
		readonly id: string;
		readonly name: string;
		readonly email: string | null;
		readonly phone: string | null;
	}[]
): string | null => {
	const phone = /^(\d+)@(?:s\.whatsapp\.net|c\.us)$/.exec(sender)?.[1];
	const id = members.some((m) => m.id === sender)
		? sender
		: memberByContact(members, phone ?? sender);
	const member = members.find((m) => m.id === id);
	if (member !== undefined) return member.name;
	if (phone !== undefined) return `+${phone}`;
	return JID.test(sender) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(sender) ? null : sender;
};
