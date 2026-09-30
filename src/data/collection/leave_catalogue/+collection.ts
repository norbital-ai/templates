import { collection, type TransformRow } from '@norbital-ai/bolt';
import { compileEligibility } from '../../../lib/payroll/run/eligibility.js';
import { compileExpression } from '../../../lib/expressions/compile.js';
import {
	refuseUnlessDraftOnBoth,
	versionsById,
	type SealedVersion
} from '../../../lib/settings_seal.js';
import type { PayrollSettings } from '../../../lib/datatypes/payroll_settings.js';
import type { LeaveEntitlement } from '../../../lib/datatypes/leave_entitlement.js';
import { plain } from '../../../lib/wire.js';
import * as Predicate from 'effect/Predicate';

type Row = {
	readonly settings_id?: string;
	readonly code?: string;
	readonly eligibility?: string;
	readonly pay_fraction?: string;
	readonly consumes_code?: string | null;
	readonly entitlement?: LeaveEntitlement;
};

const c = collection('leave_catalogue', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'settings_id',
				'code',
				'name',
				'authority',
				'eligibility',
				'evidence',
				'is_npl',
				'requires_no_pay_origin',
				'can_encash',
				'encash_on_exit',
				'pay_fraction',
				'paid_by',
				'consumes_code',
				'unit',
				'evidence_after_days',
				'entitlement'
			]
		}
	},
	update: {
		input: {
			columns: [
				'code',
				'name',
				'authority',
				'eligibility',
				'evidence',
				'is_npl',
				'requires_no_pay_origin',
				'can_encash',
				'encash_on_exit',
				'pay_fraction',
				'paid_by',
				'consumes_code',
				'unit',
				'evidence_after_days',
				'entitlement'
			]
		}
	},
	delete: {}
});
export default c;

/**
 * Sealed catalogue revisions remain the historical rules used by entitlement queries: a row of a
 * sealed version refuses create and update here, and delete through the grant. The eligibility
 * expression and every entitlement band predicate compile against the person context.
 */
c.transform(async (inputs, ctx) => {
	const existing = ctx.existing.map((row) => plain(row) as Row | undefined);
	const versions = await versionsById(ctx.db, [
		...inputs.map((input) => input.settings_id),
		...existing.map((row) => row?.settings_id)
	]);
	return inputs.map((input, index) => {
		const stored = existing[index];
		const row: Row = { ...stored, ...(plain(input) as Row) };
		refuseUnlessDraftOnBoth(
			versions,
			stored?.settings_id,
			input.settings_id,
			`Leave ${row.code ?? ''}`
		);
		// What the version's law fixes in this row's entitlement (`payroll.leave_constraints`).
		const version = versions.get(row.settings_id ?? '') as
			(SealedVersion & { readonly payroll?: PayrollSettings | null }) | undefined;
		const rule = row.entitlement;
		for (const constraint of version?.payroll?.leave_constraints ?? []) {
			if (constraint.code !== row.code) continue;
			const cite = ` (${constraint.authority})`;
			if (
				constraint.year_anchor != null &&
				(rule?.year_anchor ?? 'CALENDAR') !== constraint.year_anchor
			)
				ctx.refuse(`${row.code} must use the ${constraint.year_anchor} leave year${cite}.`);
			if (
				constraint.auto_carry_one_year != null &&
				(rule?.auto_carry_one_year ?? false) !== constraint.auto_carry_one_year
			)
				ctx.refuse(
					`${row.code} must ${constraint.auto_carry_one_year ? '' : 'not '}carry unused leave through the next leave year${cite}.`
				);
			if (
				constraint.proration_in != null &&
				!constraint.proration_in.includes(rule?.proration ?? '')
			)
				ctx.refuse(
					`${row.code} proration must be one of ${constraint.proration_in.join(', ')}${cite}.`
				);
			if (constraint.rounding != null && (rule?.rounding ?? 'HALF_DAY') !== constraint.rounding)
				ctx.refuse(`${row.code} must round a partial-year grant as ${constraint.rounding}${cite}.`);
		}
		const fault = (problem: string | null | undefined, what = '') => {
			if (problem != null) ctx.refuse(`${what}${problem}`);
		};
		fault(compileEligibility(row.eligibility));
		for (const band of row.entitlement?.bands ?? []) {
			fault(compileEligibility(band.eligibility), 'Entitlement band: ');
			if (Predicate.isString(band.days))
				fault(
					compileExpression({ expression: band.days, site: 'person', type: 'days' }),
					'Entitlement days: '
				);
		}
		const scale = row.entitlement?.scale ?? '';
		if (scale.trim() !== '')
			fault(
				compileExpression({ expression: scale, site: 'person', type: 'number' }),
				'Entitlement scale: '
			);
		fault(
			compileEligibility(row.entitlement?.encash_on_exit_when ?? ''),
			'Exit pay-out condition: '
		);
		fault(
			compileEligibility(
				row.entitlement?.encash_carry_on_exit_when ?? row.entitlement?.encash_on_exit_when ?? ''
			),
			'Carried leave exit pay-out condition: '
		);
		const lifetime = row.entitlement?.lifetime_days;
		if (Predicate.isString(lifetime))
			fault(
				compileExpression({ expression: lifetime, site: 'person', type: 'days' }),
				'Lifetime days: '
			);
		const fraction = row.pay_fraction ?? '';
		if (fraction.trim() !== '')
			fault(
				compileExpression({ expression: fraction, site: 'leave_day', type: 'number' }),
				'Pay fraction: '
			);
		if (row.consumes_code != null && row.consumes_code === row.code)
			ctx.refuse('A leave row cannot draw from its own pool; leave `consumes_code` empty.', {
				field: 'consumes_code'
			});
		return input;
	}) satisfies readonly TransformRow<'leave_catalogue'>[];
});
