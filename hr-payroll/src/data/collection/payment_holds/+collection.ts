import { collection } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
import { decodeNumber } from '../../../lib/wire.js';
import { dateKey } from '../../../lib/iso-day.js';
import { governed, settingsInForce } from '../../../lib/jurisdiction_settings.js';
import { readAll } from '../../../lib/reads.js';
import { plain } from '../../../lib/wire.js';
import { cents } from '../../../lib/payroll/run/rounding.js';
import { readRange } from '../../../lib/payroll/run/effective.js';
import { addDays } from '../../../lib/payroll/run/dates.js';

/** A disbursement hold: validated against its own release and the currency of the settings in force when placed. */
const c = collection('payment_holds', {
	read: { fields: 'all' },
	queries: {
		ir21_remittance_status: {
			description:
				'IR21 directive tax remittance due, overdue, paid on time or paid late for one entity as of a calendar day.',
			input: {
				company_id: { kind: 'id', of: 'companies' },
				as_of: { kind: 'date' }
			},
			output: { kind: 'json' }
		}
	},
	create: {
		input: {
			columns: [
				'employment_id',
				'category',
				'directive_reference',
				'amount',
				'held_on',
				'released_on',
				'released_amount',
				'release_basis',
				'iras_notice_received_on',
				'release_directive_on',
				'amended_ir21_filed_on',
				'directive_tax_amount',
				'tax_remitted_amount',
				'tax_remitted_on',
				'tax_remittance_reference',
				'tax_remittance_evidence_file',
				'reconciliation_reference',
				'evidence_file'
			]
		}
	},
	update: {
		input: {
			columns: [
				'category',
				'directive_reference',
				'amount',
				'held_on',
				'released_on',
				'released_amount',
				'release_basis',
				'iras_notice_received_on',
				'release_directive_on',
				'amended_ir21_filed_on',
				'directive_tax_amount',
				'tax_remitted_amount',
				'tax_remitted_on',
				'tax_remittance_reference',
				'tax_remittance_evidence_file',
				'reconciliation_reference',
				'evidence_file'
			]
		}
	},
	delete: {}
});

type Hold = {
	readonly employment_id?: string | null;
	readonly directive_reference?: string | null;
	readonly amount?: unknown;
	readonly held_on?: string | null;
	readonly released_on?: string | null;
	readonly released_amount?: unknown;
	readonly release_basis?: 'RELEASE_NOTICE' | 'PAY_TAX_DIRECTIVE' | 'THIRTY_DAY_EXPIRY' | null;
	readonly iras_notice_received_on?: string | null;
	readonly release_directive_on?: string | null;
	readonly amended_ir21_filed_on?: string | null;
	readonly directive_tax_amount?: unknown;
	readonly tax_remittance_due_on?: string | null;
	readonly tax_remitted_amount?: unknown;
	readonly tax_remitted_on?: string | null;
	readonly tax_remittance_reference?: string | null;
	readonly tax_remittance_evidence_file?: unknown;
	readonly reconciliation_reference?: string | null;
	readonly category?: string | null;
	readonly evidence_file?: unknown;
};
type Version = Parameters<typeof settingsInForce>[0][number] & {
	readonly payroll: {
		readonly currency?: string;
		readonly tax_clearance?: {
			readonly reference_label?: string;
			readonly max_withhold_days?: number;
			readonly tax_payment_days?: number;
		} | null;
	} | null;
};

c.transform(async (inputs, ctx) => {
	// An explicitly typed alias, so a refusal narrows what follows it (TS control flow).
	const refuse: (message: string, at?: { field?: string }) => never = (message, at) =>
		ctx.refuse(message, at as never);
	const rows = inputs.map((input, index) => ({
		...(plain(ctx.existing[index] ?? {}) as Hold),
		...input
	}));
	const employmentIds = [
		...new Set(rows.flatMap((row) => (row.employment_id == null ? [] : [row.employment_id])))
	];
	const [employments, companies] = await Promise.all([
		readAll<{
			readonly id: string;
			readonly company_id: string;
			readonly effective_range: unknown;
		}>(ctx.db, 'employments', {
			id: { in: employmentIds }
		}),
		readAll<{ readonly id: string; readonly settings_code: string }>(ctx.db, 'companies', {
			employments: { some: { id: { in: employmentIds } } }
		})
	]);
	const codes = [
		...new Set(companies.map((row) => row.settings_code).filter((code) => code !== ''))
	];
	const versions = await readAll<Version>(ctx.db, 'jurisdiction_settings', {
		code: { in: codes },
		sealed_at: { isNull: false },
		voided_at: { isNull: true },
		approval_id: { isNull: true }
	});
	const codeOf = new Map(
		employments.map((row) => [
			row.id,
			companies.find((company) => company.id === row.company_id)?.settings_code
		])
	);
	const remittanceDue = new Map<number, ReturnType<typeof PlainDate> | null>();
	for (const [index, row] of rows.entries()) {
		const employmentId = row.employment_id;
		if (employmentId == null || !codeOf.has(employmentId))
			refuse('A payment hold must reference an employment.', { field: 'employment_id' });
		if (!(row.directive_reference ?? '').trim())
			refuse('A payment hold requires the directive reference.', {
				field: 'directive_reference'
			});
		const held = dateKey(row.held_on);
		if (held === '') refuse('A payment hold requires the day it was placed.', { field: 'held_on' });
		const released = row.released_on == null ? null : dateKey(row.released_on) || null;
		if (released == null && row.tax_remittance_due_on != null) remittanceDue.set(index, null);
		if (released != null && released < held)
			refuse('A hold cannot be released before it was placed.', { field: 'released_on' });
		const amount = row.amount == null ? null : decodeNumber(row.amount);
		const releasedAmount = row.released_amount == null ? null : decodeNumber(row.released_amount);
		for (const [label, value] of [
			['Hold amount', amount],
			['Released amount', releasedAmount]
		] as const)
			if (value != null && !(value >= 0)) refuse(`${label} must be finite and nonnegative.`);
		if (released != null) {
			if (releasedAmount == null)
				refuse('Releasing a hold requires the amount released.', { field: 'released_amount' });
			if (!(row.reconciliation_reference ?? '').trim())
				refuse('Releasing a hold requires the directive or filing receipt reference.', {
					field: 'reconciliation_reference'
				});
			if (amount != null && releasedAmount > amount)
				refuse('The released amount cannot exceed the held amount.', {
					field: 'released_amount'
				});
		} else if (releasedAmount != null || row.reconciliation_reference != null) {
			refuse('A release amount or reference applies only to a released hold.');
		}
		const code = codeOf.get(employmentId);
		const earliest =
			code == null
				? undefined
				: versions
						.filter((version) => version.code === code)
						.map((version) => governed(version.effective_range)?.from)
						.filter((day): day is string => day != null)
						.toSorted()[0];
		const exit = dateKey(
			readRange(employments.find((row) => row.id === employmentId)?.effective_range)?.end
		);
		const version =
			code == null
				? undefined
				: (settingsInForce(versions, code, held) ??
					(earliest != null && held < earliest && exit !== ''
						? settingsInForce(versions, code, exit)
						: undefined));
		const currency = version?.payroll?.currency;
		if (currency == null)
			refuse('A payment hold requires sealed jurisdiction settings on the day it was placed.');
		if (
			version?.payroll?.tax_clearance?.reference_label === 'IR21' &&
			(row.category ?? 'TAX_CLEARANCE') === 'TAX_CLEARANCE'
		) {
			const clearance = version?.payroll?.tax_clearance;
			const directive = dateKey(row.release_directive_on);
			const amended = dateKey(row.amended_ir21_filed_on);
			let taxDue: number | null = null;
			if (row.release_basis === 'PAY_TAX_DIRECTIVE') {
				if (directive === '')
					refuse('An IRAS release requires the directive date.', { field: 'release_directive_on' });
				if (row.evidence_file == null)
					refuse('Singapore tax clearance release requires IRAS evidence.', {
						field: 'evidence_file'
					});
				const paymentDays = clearance?.tax_payment_days;
				if (paymentDays == null)
					refuse('Singapore tax clearance requires a sealed tax-payment deadline.');
				remittanceDue.set(index, PlainDate(addDays(directive, paymentDays)));
				taxDue = row.directive_tax_amount == null ? null : decodeNumber(row.directive_tax_amount);
				if (taxDue == null || !(taxDue > 0) || cents(taxDue, currency) !== taxDue)
					refuse('A pay-tax directive requires a positive tax amount in currency precision.');
				const remitted =
					row.tax_remitted_amount == null ? null : decodeNumber(row.tax_remitted_amount);
				const remittedOn = dateKey(row.tax_remitted_on);
				if (remitted != null && remittedOn === '')
					refuse('Recorded IRAS tax remittance requires the tax remittance date.', {
						field: 'tax_remitted_on'
					});
				if (remittedOn !== '' && remittedOn < directive)
					refuse('Tax remittance cannot precede the directive.');
				if (remittedOn !== '' && remittedOn > ctx.today)
					refuse('A future tax remittance cannot be recorded as paid.');
				if (
					remittedOn !== '' &&
					(remitted !== taxDue || !(row.tax_remittance_reference ?? '').trim())
				)
					refuse('Tax remittance must reconcile with the directive and have a payment reference.');
				if (remittedOn !== '' && row.tax_remittance_evidence_file == null)
					refuse('Recorded IRAS tax remittance requires remittance evidence.');
			}
			if (released != null) {
				const waitDays = clearance?.max_withhold_days;
				if (waitDays == null) refuse('Singapore tax clearance requires a sealed release rule.');
				if (row.release_basis == null)
					refuse('Singapore tax clearance release requires a release basis.', {
						field: 'release_basis'
					});
				if (row.evidence_file == null)
					refuse('Singapore tax clearance release requires IRAS evidence.', {
						field: 'evidence_file'
					});
				if (amount == null)
					refuse('Singapore tax clearance release requires the amount withheld.', {
						field: 'amount'
					});
				if (row.release_basis === 'THIRTY_DAY_EXPIRY') {
					const received = dateKey(row.iras_notice_received_on);
					if (received === '')
						refuse('The day IRAS received the IR21 notice is required for 30-day expiry.', {
							field: 'iras_notice_received_on'
						});
					if (amended !== '' && amended <= released)
						refuse('An amended IR21 requires a fresh clearance directive before release.');
					if (released < addDays(received, waitDays))
						refuse('The IR21 hold cannot expire before 30 days after IRAS received notice.');
					if (
						row.release_directive_on != null ||
						row.directive_tax_amount != null ||
						row.tax_remitted_amount != null
					)
						refuse('A directive or tax remittance cannot be used as a 30-day expiry.');
				} else {
					if (directive === '')
						refuse('An IRAS release requires the directive date.', {
							field: 'release_directive_on'
						});
					if (directive > released) refuse('The IRAS directive cannot be dated after the release.');
					if (amended !== '' && amended <= released && directive < amended)
						refuse('An amended IR21 requires a fresh clearance directive before release.');
					if (row.release_basis === 'PAY_TAX_DIRECTIVE') {
						if (releasedAmount !== cents(Math.max(0, amount - taxDue!), currency))
							refuse('The release must reconcile withheld money less the directive tax amount.');
					} else if (row.release_basis === 'RELEASE_NOTICE') {
						if (
							row.directive_tax_amount != null ||
							row.tax_remitted_amount != null ||
							row.tax_remitted_on != null
						)
							refuse('A release notice cannot record a tax remittance.');
					} else refuse('Unknown Singapore tax clearance release basis.');
				}
				if (row.release_basis !== 'PAY_TAX_DIRECTIVE' && releasedAmount !== amount)
					refuse('The released amount must reconcile with all money withheld.');
				if (row.release_basis !== 'PAY_TAX_DIRECTIVE') remittanceDue.set(index, null);
			}
		}
		for (const [label, value] of [
			['Hold amount', amount],
			['Released amount', releasedAmount]
		] as const)
			if (value != null && cents(value, currency) !== value)
				refuse(`${label} must use the jurisdiction currency precision.`);
	}
	return inputs.map((input, index) =>
		remittanceDue.has(index)
			? { ...input, tax_remittance_due_on: remittanceDue.get(index) ?? null }
			: input
	);
});

c.query('ir21_remittance_status', async ({ company_id, as_of }, ctx) => {
	const companies = await ctx.read('companies', {
		where: { id: { eq: company_id } },
		all: true
	});
	const code = companies.rows[0]?.settings_code;
	if (code == null) return [];
	const versions = await ctx.read('jurisdiction_settings', {
		where: {
			code: { eq: code },
			sealed_at: { isNull: false },
			voided_at: { isNull: true },
			approval_id: { isNull: true }
		},
		select: {
			id: true,
			code: true,
			effective_range: true,
			sealed_at: true,
			voided_at: true,
			approval_id: true,
			payroll: true
		},
		all: true
	});
	const employments = await ctx.read('employments', {
		where: { company_id: { eq: company_id } },
		all: true
	});
	const employmentIds = employments.rows.map((row) => row.id);
	if (employmentIds.length === 0) return [];
	const holds = await ctx.read('payment_holds', {
		where: { employment_id: { in: employmentIds } },
		all: true
	});
	const asOf = dateKey(as_of);
	return holds.rows
		.filter(
			(row) =>
				settingsInForce(versions.rows, code, dateKey(row.held_on))?.payroll?.tax_clearance
					?.reference_label === 'IR21' &&
				row.category === 'TAX_CLEARANCE' &&
				row.release_basis === 'PAY_TAX_DIRECTIVE' &&
				dateKey(row.release_directive_on) !== '' &&
				dateKey(row.release_directive_on) <= asOf
		)
		.map((row) => {
			const due = dateKey(row.tax_remittance_due_on);
			const paid = dateKey(row.tax_remitted_on);
			const status =
				due === ''
					? 'UNASSESSED'
					: paid !== '' && paid <= asOf
						? paid <= due
							? 'PAID_ON_TIME'
							: 'PAID_LATE'
						: asOf > due
							? 'OVERDUE'
							: asOf === due
								? 'DUE'
								: 'PENDING';
			return {
				hold_id: row.id,
				employment_id: row.employment_id,
				amount: row.directive_tax_amount == null ? null : decodeNumber(row.directive_tax_amount),
				due_on: due || null,
				paid_on: paid !== '' && paid <= asOf ? paid : null,
				status
			};
		})
		.toSorted((left, right) => left.hold_id.localeCompare(right.hold_id));
});

export default c;
