import {
	rosterCodeVariantSchema,
	type RosterCodeVariant
} from '../../custom-types/roster_code_variant/+definition.js';

const MINUTES_PER_DAY = 24 * 60;

export type RosterCodeLike = {
	readonly norbital_id?: string;
	readonly code: string;
	readonly variant: unknown;
};

export type WorkWindow = {
	readonly start_time: string;
	readonly end_time: string;
	readonly break_minutes: number;
	readonly crosses_midnight: boolean;
	readonly elapsed_minutes: number;
	readonly paid_minutes: number;
};

export function clockMinutes(value: string): number {
	const [hours, minutes] = value.split(':').map(Number);
	return hours * 60 + minutes;
}

export function rosterCodeVariant(value: unknown): RosterCodeVariant {
	return rosterCodeVariantSchema.parse(value);
}

export function workWindow(value: unknown): WorkWindow | null {
	const variant = rosterCodeVariant(value);
	if (variant.kind !== 'WORK') return null;
	const start = clockMinutes(variant.start_time);
	const rawEnd = clockMinutes(variant.end_time);
	const crossesMidnight = rawEnd <= start;
	const end = crossesMidnight ? rawEnd + MINUTES_PER_DAY : rawEnd;
	const elapsed = end - start;
	if (variant.break_minutes >= elapsed) {
		throw new Error('A roster code break must be shorter than its work window.');
	}
	return {
		start_time: variant.start_time,
		end_time: variant.end_time,
		break_minutes: variant.break_minutes,
		crosses_midnight: crossesMidnight,
		elapsed_minutes: elapsed,
		paid_minutes: elapsed - variant.break_minutes
	};
}

export function rosterCodeKind(value: unknown): RosterCodeVariant['kind'] {
	return rosterCodeVariant(value).kind;
}
