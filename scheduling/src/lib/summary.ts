/** A collapsed section's one-line summary of free text: its first line; '' when empty. */
export const excerpt = (value: string | null | undefined): string =>
	(value ?? '').trim().split('\n')[0] ?? '';
