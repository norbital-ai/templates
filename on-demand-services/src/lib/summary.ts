import { bolt } from '$bolt';
import { useKinds } from '@norbital-ai/ui';
/** A collapsed section's one-line summary of free text: its first line; '' when empty. */
export const excerpt = (value: string | null | undefined): string =>
	(value ?? '').trim().split('\n')[0] ?? '';
/** An instant as a short local date and time ("1 Oct, 14:05"). */
export function useWhen() {
	const zone = useKinds().zone;
	return (instant: string): string =>
		new Intl.DateTimeFormat(bolt.locale, {
			...(zone === undefined ? {} : { timeZone: zone }),
			day: 'numeric',
			month: 'short',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(instant));
}
