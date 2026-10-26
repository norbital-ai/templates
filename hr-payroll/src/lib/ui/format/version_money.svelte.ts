import type { Id } from '@norbital-ai/bolt';
import { bolt } from '$bolt';
import { formatNumeric } from './display_formatters.js';

/** Which settings version prices the amounts on screen: by id, by a payroll run, or a lineage's version in force today. */
type Governing =
	| { readonly version: Id<'jurisdiction_settings'> }
	| { readonly run: Id<'payroll_run'> }
	| { readonly lineage: string };

/**
 * Amounts formatted at the payroll currency's minor units of the governing version (`payroll.minor_units`, else the
 * currency's own: IDR none, SGD two), live. Before the version answers, two places. Call during component init.
 */
/** The governing version's `payroll`, live; undefined before it answers. Call during component init. */
export function governingPayroll(governing: () => Governing | null) {
	const clock = bolt.clock('day');
	const rows = $derived.by(() => {
		const g = governing();
		if (g == null) return null;
		const where =
			'version' in g
				? { id: { eq: g.version } }
				: 'run' in g
					? { payroll_run: { some: { id: { eq: g.run } } } }
					: {
							code: { eq: g.lineage },
							sealed_at: { isNull: false },
							voided_at: { isNull: true },
							effective_range: { contains: clock.today }
						};
		return bolt.query('jurisdiction_settings', { where, select: { payroll: true }, limit: 1 });
	});
	return () => rows?.current?.rows?.[0]?.payroll;
}

export function versionMoney(governing: () => Governing | null) {
	const payroll = governingPayroll(governing);
	return (value: unknown): string =>
		formatNumeric(value, payroll()?.currency, payroll()?.minor_units);
}

/** The governing version's pay calendar (`week_start`, `semi_monthly_split`, `ten_day_splits`), live; null before the
 * version answers. Call during component init. */
export function versionCalendar(governing: () => Governing | null) {
	const payroll = governingPayroll(governing);
	return () => {
		const held = payroll();
		return held == null
			? null
			: {
					...(held.week_start == null ? {} : { week_start: held.week_start }),
					...(held.semi_monthly_split == null
						? {}
						: { semi_monthly_split: held.semi_monthly_split }),
					...(held.ten_day_splits == null ? {} : { ten_day_splits: held.ten_day_splits })
				};
	};
}
