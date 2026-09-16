/**
 * The pay period an event page steps its one-off entries by, in the selected entity's grammar.
 *
 * Four catalogue pages step the same way — a month at a monthly company, a half at a semi-monthly
 * one — and each needs the period, whether halves are offered, and the dates whose entries settle
 * in it. One owner, so the four pages cannot drift.
 */
import { decodeNumber } from '@norbital-ai/std/json';
import { payPeriodWindow } from '../../collections/payroll_runs/lib/period.js';
import { dayWindowInstantBounds, periodInCompanyGrammar, todayKey } from './calendar.js';

type PayGridCompany = {
	readonly pay_frequency: string;
	readonly pay_cutoff_day: unknown;
};

export function createPayPeriodScope(company: () => PayGridCompany | null | undefined) {
	let chosen = $state<string>(todayKey().slice(0, 7));
	const period = $derived(periodInCompanyGrammar(chosen, company()?.pay_frequency, todayKey()));
	const window = $derived.by(() => {
		const row = company();
		if (row == null) return null;
		try {
			return payPeriodWindow(period, {
				pay_frequency: row.pay_frequency,
				pay_cutoff_day: decodeNumber(row.pay_cutoff_day)
			});
		} catch {
			return null;
		}
	});
	const bounds = $derived(window == null ? null : dayWindowInstantBounds(window));
	return {
		get period() {
			return period;
		},
		/** The window as query instants: inclusive `start`, exclusive `end`. Filter with gte / lt. */
		get bounds() {
			return bounds;
		},
		get halves() {
			return company()?.pay_frequency === 'SEMI_MONTHLY';
		},
		/** The `start`..`end` days whose entries settle in the period, or null without an entity. */
		get window() {
			return window;
		},
		select(next: string): void {
			if (/^\d{4}-(0[1-9]|1[0-2])(-[12])?$/.test(next)) chosen = next;
		}
	};
}
