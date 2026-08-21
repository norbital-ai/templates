import type { WorkPattern } from '../../datatypes/work_pattern/+definition.js';
import { rosterCodeKind, workWindow, type RosterCodeLike } from './roster-code.js';

const DAY_MS = 86_400_000;

function dateNumber(date: string): number {
	const value = Date.parse(`${date}T00:00:00.000Z`);
	if (Number.isNaN(value)) throw new Error(`Invalid calendar date "${date}".`);
	return Math.floor(value / DAY_MS);
}

function addMonths(date: string, months: number): string {
	const source = new Date(`${date}T00:00:00.000Z`);
	const sourceDay = source.getUTCDate();
	const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1));
	const last = new Date(
		Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
	).getUTCDate();
	target.setUTCDate(Math.min(sourceDay, last));
	return target.toISOString().slice(0, 10);
}

function patternedPhaseOn(pattern: Extract<WorkPattern, { type: 'PATTERNED' }>, date: string) {
	if (pattern.phases.length === 1 && pattern.phases[0]!.duration.kind === 'CONTINUOUS') {
		return { phase: pattern.phases[0]!, startsOn: pattern.anchor_date };
	}
	if (pattern.phases.some((phase) => phase.duration.kind === 'CONTINUOUS')) {
		throw new Error('CONTINUOUS is valid only for a single-phase work pattern.');
	}

	let cycleStart = pattern.anchor_date;
	if (date < cycleStart) {
		const cycleMonths = pattern.phases.reduce((total, phase) => {
			if (phase.duration.kind !== 'CALENDAR_MONTHS') {
				throw new Error('A multi-phase pattern requires calendar-month durations.');
			}
			return total + phase.duration.months;
		}, 0);
		// Move back in whole outer cycles until this date is in or after the candidate cycle. The
		// anchor identifies a phase boundary; it is not the earliest date payroll is allowed to ask.
		do {
			cycleStart = addMonths(cycleStart, -cycleMonths);
		} while (date < cycleStart);
	}
	for (;;) {
		for (const phase of pattern.phases) {
			if (phase.duration.kind !== 'CALENDAR_MONTHS') continue;
			const phaseEnd = addMonths(cycleStart, phase.duration.months);
			if (date < phaseEnd) return { phase, startsOn: cycleStart };
			cycleStart = phaseEnd;
		}
	}
}

export function patternRosterCodeId(pattern: WorkPattern, date: string): string | null {
	if (pattern.type === 'ROSTERED') return null;
	const { phase, startsOn } = patternedPhaseOn(pattern, date);
	const offset = dateNumber(date) - dateNumber(startsOn);
	const index =
		((offset % phase.day_cycle.length) + phase.day_cycle.length) % phase.day_cycle.length;
	return phase.day_cycle[index]!.roster_code_id;
}

export type PatternWorkload = {
	readonly work_days: number;
	readonly paid_minutes: number;
	readonly reference_days: number;
	readonly average_weekly_paid_minutes: number;
};

/**
 * Derive the amount promised by a pattern. For calendar-month phases the full outer sequence is
 * enumerated once, so February and a 31-day month contribute their real number of days rather than
 * an invented four-weeks-per-month approximation.
 */
export function patternWorkload(
	pattern: WorkPattern,
	rosterCodeById: ReadonlyMap<string, RosterCodeLike>
): PatternWorkload | null {
	if (pattern.type === 'ROSTERED') {
		if (pattern.expectation.kind === 'AS_ASSIGNED') return null;
		const referenceDays = pattern.expectation.period === 'WEEK' ? 7 : 30;
		return {
			work_days: pattern.expectation.required_work_days,
			paid_minutes: pattern.expectation.required_paid_minutes,
			reference_days: referenceDays,
			average_weekly_paid_minutes: (pattern.expectation.required_paid_minutes * 7) / referenceDays
		};
	}

	let referenceDays: number;
	if (pattern.phases.length === 1 && pattern.phases[0]!.duration.kind === 'CONTINUOUS') {
		referenceDays = pattern.phases[0]!.day_cycle.length;
	} else {
		let end = pattern.anchor_date;
		for (const phase of pattern.phases) {
			if (phase.duration.kind !== 'CALENDAR_MONTHS') {
				throw new Error('A multi-phase pattern requires calendar-month durations.');
			}
			end = addMonths(end, phase.duration.months);
		}
		referenceDays = dateNumber(end) - dateNumber(pattern.anchor_date);
	}

	let workDays = 0;
	let paidMinutes = 0;
	for (let offset = 0; offset < referenceDays; offset += 1) {
		const date = new Date((dateNumber(pattern.anchor_date) + offset) * DAY_MS)
			.toISOString()
			.slice(0, 10);
		const id = patternRosterCodeId(pattern, date);
		const code = id == null ? null : rosterCodeById.get(id);
		if (code == null) throw new Error(`Work pattern names missing roster code ${id ?? '(none)'}.`);
		if (rosterCodeKind(code.variant) !== 'WORK') continue;
		workDays += 1;
		paidMinutes += workWindow(code.variant)!.paid_minutes;
	}
	return {
		work_days: workDays,
		paid_minutes: paidMinutes,
		reference_days: referenceDays,
		average_weekly_paid_minutes: (paidMinutes * 7) / referenceDays
	};
}
