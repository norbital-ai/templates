import { isClockTime } from '../iso-day.js';

/**
 * The meaning of one roster code. A WORK code owns its clock window and unpaid break; REST and OFF
 * carry no clock. PUBLIC_HOLIDAY is absent: it is resolved from the published holidays.
 */
export type RosterCodeVariant =
	| {
			readonly kind: 'WORK';
			readonly start_time: string;
			readonly end_time: string;
			readonly break_minutes: number;
			/** Start of the scheduled unpaid break; its end is start plus break_minutes. */
			readonly break_start_time?: string | null;
	  }
	| {
			readonly kind: 'REST';
			/** The rest day the statute forbids work on (TW 勞基法 §36/§40 例假); absent is ordinary. */
			readonly statutory?: boolean | null;
	  }
	| { readonly kind: 'OFF' };

export const rosterCodeVariantFault = (value: RosterCodeVariant): string | undefined => {
	if (value.kind !== 'WORK') return undefined;
	if (
		!isClockTime(value.start_time) ||
		!isClockTime(value.end_time) ||
		!Number.isInteger(value.break_minutes) ||
		value.break_minutes < 0 ||
		(value.break_start_time != null && !isClockTime(value.break_start_time))
	)
		return 'A working code states HH:MM start and end times and a whole-minute break.';
	if (value.break_start_time == null) return undefined;
	const minutes = (clock: string) =>
		(clock.charCodeAt(0) - 48) * 600 +
		(clock.charCodeAt(1) - 48) * 60 +
		(clock.charCodeAt(3) - 48) * 10 +
		clock.charCodeAt(4) -
		48;
	const start = minutes(value.start_time);
	const end = minutes(value.end_time) + (value.end_time <= value.start_time ? 1440 : 0);
	const breakStart =
		minutes(value.break_start_time) + (value.break_start_time < value.start_time ? 1440 : 0);
	if (value.break_minutes === 0 || breakStart <= start || breakStart + value.break_minutes >= end)
		return 'A scheduled break must start and end inside the working clock window.';
	return undefined;
};
