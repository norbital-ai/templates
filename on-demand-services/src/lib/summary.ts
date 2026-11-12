import type { PageContext } from '@norbital-ai/bolt/page';
/** A collapsed section's one-line summary of free text: its first line; '' when empty. */
export const excerpt = (value: string | null | undefined): string =>
	(value ?? '').trim().split('\n')[0] ?? '';
/** An instant as a short local date and time ("1 Oct, 14:05"). */
export function useWhen(ctx: Pick<PageContext, 'locale' | 'tz'>) {
	return (instant: string): string =>
		new Intl.DateTimeFormat(ctx.locale, {
			timeZone: ctx.tz,
			day: 'numeric',
			month: 'short',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(instant));
}
