/**
 * The pay period an event page steps its one-off entries by, in the selected entity's schedule.
 *
 * Four catalogue pages step the same way — a month at a monthly company, a half at a semi-monthly
 * one — and each needs the period, whether halves are offered, and the dates whose entries settle
 * in it. One owner, so the four pages cannot drift. The schedule is effective-dated (`frequencyOn`):
 * a month reads the periods of the frequencies in force on its days (`periodsIn`).
 */
import { PlainDate } from '@norbital-ai/std/date';
import { frequencyOn } from '../../payroll_engine/foundation.js';
import { todayKey } from '../format/calendar.js';
import { periodIn, type PayingEntity } from '../payroll/pay_periods.js';
import { versionCalendar } from '../format/version_money.svelte.js';

export function createPayPeriodScope(
	company: () => (PayingEntity & { readonly settings_code?: string | null }) | null | undefined
) {
	let chosen = $state<string>(todayKey().slice(0, 7));
	// the periods are cut by the calendar of the version governing the entity's lineage today
	const calendar = versionCalendar(() => {
		const lineage = company()?.settings_code;
		return lineage == null || lineage === '' ? null : { lineage };
	});
	const found = $derived.by(() => {
		const row = company();
		return row == null ? null : periodIn(row, calendar() ?? {}, chosen, todayKey());
	});
	/** The frequency the chosen period is paid at: the one in force on its first day. */
	const frequency = $derived.by(() => {
		const row = company();
		return row == null ? null : frequencyOn(row, found?.from ?? `${chosen.slice(0, 7)}-01`);
	});
	return {
		get period() {
			return found?.key ?? chosen.slice(0, 7);
		},
		get halves() {
			return frequency === 'SEMI_MONTHLY';
		},
		get weeks() {
			return frequency === 'WEEKLY';
		},
		/** The `start`..`end` days (both inclusive) whose entries settle in the period, or null without an entity. */
		get window() {
			return found == null
				? null
				: { start: PlainDate(found.window.from), end: PlainDate(found.window.to) };
		},
		select(next: string): void {
			if (/^\d{4}-(0[1-9]|1[0-2])(-[12])?$/.test(next)) chosen = next;
		}
	};
}
