import type { RosterCodeVariant } from '../../../custom-types/roster_code_variant/+definition.js';

/**
 * Whether an explicit assignment schedules work on a day that was otherwise non-working.
 *
 * This is intentionally a pure derivation, not a roster-entry column or an OT kind. The eventual
 * approval gate can call the same rule after resolving the baseline pattern and observed calendar.
 * A ROSTERED employment with no baseline is not automatically extra work: as-assigned work is its
 * ordinary scheduling model unless the date is an observed holiday.
 */
export function isScheduledExtraWork(input: {
	readonly assigned: RosterCodeVariant;
	readonly baseline: RosterCodeVariant | null;
	readonly observedPublicHoliday: boolean;
}): boolean {
	if (input.assigned.kind !== 'WORK') return false;
	return (
		input.observedPublicHoliday || input.baseline?.kind === 'REST' || input.baseline?.kind === 'OFF'
	);
}
