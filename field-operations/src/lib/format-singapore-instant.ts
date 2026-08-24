/**
 * Render one instant for a Singapore-local operator without depending on the browser's time zone.
 *
 * Callers own the localized empty value so this utility stays independent of any one i18n catalog.
 */
export function formatSingaporeInstant(
	value: string | null | undefined,
	notRecorded: string
): string {
	if (!value) return notRecorded;
	return new Intl.DateTimeFormat('en-SG', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: 'Asia/Singapore'
	}).format(new Date(value));
}
