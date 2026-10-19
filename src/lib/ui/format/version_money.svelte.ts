import type { Id } from '@norbital-ai/bolt';
import { bolt } from '$bolt';
import { liveRows } from '../state/live.svelte.js';
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
export function versionMoney(governing: () => Governing | null) {
	const rows = liveRows(() => {
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
							effective_range: { contains: { today: '' as const } }
						};
		return bolt.read('jurisdiction_settings', { where, select: { payroll: true }, limit: 1 });
	});
	const payroll = $derived(rows.current?.[0]?.payroll);
	return (value: unknown): string => formatNumeric(value, payroll?.currency, payroll?.minor_units);
}
