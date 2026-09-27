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
	  }
	| {
			readonly kind: 'REST';
			/** The rest day the statute forbids work on (TW 勞基法 §36/§40 例假); absent is ordinary. */
			readonly statutory?: boolean | null;
	  }
	| { readonly kind: 'OFF' };

export const rosterCodeVariantFault = (value: RosterCodeVariant): string | undefined =>
	value.kind === 'WORK' &&
	(!isClockTime(value.start_time) ||
		!isClockTime(value.end_time) ||
		!Number.isInteger(value.break_minutes) ||
		value.break_minutes < 0)
		? 'A working code states HH:MM start and end times and a whole-minute break.'
		: undefined;
