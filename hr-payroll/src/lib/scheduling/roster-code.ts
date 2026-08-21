import type { RosterCodeVariant } from '../../datatypes/roster_code_variant/+definition.js';

const MINUTES_PER_DAY = 24 * 60;

export type RosterCodeLike = {
	readonly norbital_id?: string;
	readonly code: string;
	readonly variant: RosterCodeVariant;
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

/**
 * A `variant` read from storage is already a decoded `roster_code_variant` — the write boundary
 * validates the column against the strict schema, so no re-decode is needed here.
 */
export function rosterCodeVariant(value: RosterCodeVariant | null | undefined): RosterCodeVariant {
	if (value == null) throw new Error('A roster code variant is required.');
	return value;
}

export function workWindow(value: RosterCodeVariant | null | undefined): WorkWindow | null {
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

export function rosterCodeKind(
	value: RosterCodeVariant | null | undefined
): RosterCodeVariant['kind'] {
	return rosterCodeVariant(value).kind;
}

function clockFromMinutes(minutes: number): string {
	const normalized = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
	const hours = Math.floor(normalized / 60);
	const mins = normalized % 60;
	return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/** First/second half of a WORK window, used by leave so night shifts are not labelled AM/PM. */
export function workWindowHalves(
	value: RosterCodeVariant | null | undefined
): { readonly span: string; readonly first: string; readonly second: string } | null {
	let window: WorkWindow | null;
	try {
		window = workWindow(value);
	} catch {
		return null;
	}
	if (window == null) return null;
	const start = clockMinutes(window.start_time);
	const midpoint = clockFromMinutes(start + Math.floor(window.elapsed_minutes / 2));
	return {
		span: `${window.start_time}–${window.end_time}`,
		first: `${window.start_time}–${midpoint}`,
		second: `${midpoint}–${window.end_time}`
	};
}
