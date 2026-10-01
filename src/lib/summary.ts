import { bolt } from '$bolt';

/** A collapsed section's one-line summary of free text: its first line; '' when empty. */
export const excerpt = (value: unknown): string =>
	String(value ?? '')
		.trim()
		.split('\n')[0] ?? '';

/** An instant as a short local date and time ("1 Oct, 14:05"). */
export const when = (instant: string): string =>
	new Intl.DateTimeFormat(bolt.locale, {
		day: 'numeric',
		month: 'short',
		hour: 'numeric',
		minute: '2-digit'
	}).format(new Date(instant));
