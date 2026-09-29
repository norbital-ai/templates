import { collection } from '@norbital-ai/bolt';
import { decodeNumber } from '../../../lib/wire.js';
import { dateKey } from '../../../lib/iso-day.js';
import { readAll } from '../../../lib/reads.js';
import { plain } from '../../../lib/wire.js';
import { cents } from '../../../lib/payroll/run/rounding.js';
import type { WorkspaceRow } from '../../../lib/rows.js';
import { settingsInForce } from '../../../lib/jurisdiction_settings.js';
import { coversDate, readRange } from '../../../lib/payroll/run/effective.js';
import { isEligible, personContext, scalarFacts } from '../../../lib/payroll/run/eligibility.js';
import { resolveExitFacts } from '../../../lib/declared-facts.js';
import * as Predicate from 'effect/Predicate';

/**
 * Payslips are created only by their run. Calculated amounts are immutable; payment state and funding receipts
 * are operational records, editable until settlement.
 *
 * `status` is the model's state (DRAFT ↔ ON_HOLD → PAID; PAID edits nothing): money that left is corrected by an
 * entry in a later draft run. `paid_at` is supplied with PAID (back-dating allowed) and validated here, with the
 * funding receipt, the open disbursement holds and the person's payment order (L-TPL-hr-payroll-136).
 *
 * A delete releases exactly the entries the slip pinned (`setNull`). The grant keeps a paid or funded slip
 * (`UNPAID_PAYSLIP`); the delete guard keeps a slip a later slip of the same person stands on.
 */
const c = collection('payslips', {
	read: { fields: 'all' },
	update: {
		input: {
			columns: ['status', 'paid_at', 'funding_received', 'funding_received_on', 'funding_reference']
		}
	},
	delete: { transform: true }
});

type Slip = {
	readonly id: string;
	readonly payroll_run_id: string;
	readonly employment_id: string;
	readonly status: string;
	readonly payment_mode: string;
	readonly paid_at: string | null;
	readonly currency: string;
	readonly statutory?: readonly { readonly payment_occasion?: boolean | null }[] | null;
	readonly unfunded_contributions: unknown;
	readonly funding_received: unknown;
	readonly funding_received_on: string | null;
	readonly funding_reference: string | null;
};
type Run = {
	readonly id: string;
	readonly company_id: string;
	readonly period: string;
	readonly pay_date?: string | null;
};
type Hold = {
	readonly employment_id: string;
	readonly category: string;
	readonly directive_reference: string;
	readonly released_on: string | null;
};

c.transform(async (inputs, ctx) => {
	// An explicitly typed alias, so a refusal narrows what follows it (TS control flow).
	const refuse: (message: string, at?: { field?: string }) => never = (message, at) =>
		ctx.refuse(message, at as never);
	const stored = ctx.existing.map((row) => (row == null ? undefined : (plain(row) as Slip)));
	const employmentIds = [
		...new Set(stored.flatMap((slip) => (slip == null ? [] : [slip.employment_id])))
	];

	if (inputs.some((input) => '$delete' in input)) {
		// A later period's year-to-date and withholding read every earlier slip of the person, paid or not, so
		// the later slip goes first. Slips deleted together are judged together.
		const [slips, runs] = await Promise.all([
			readAll<Slip>(ctx.db, 'payslips', { employment_id: { in: employmentIds } }),
			readAll<Run>(ctx.db, 'payroll_runs', {
				payslips: { some: { employment_id: { in: employmentIds } } }
			})
		]);
		const runById = new Map(runs.map((run) => [run.id, run]));
		const gone = new Set(stored.flatMap((slip) => (slip == null ? [] : [slip.id])));
		const tranches = await readAll<{ readonly id: string }>(ctx.db, 'payable_tranches', {
			settlement: { payslips: { in: [...gone] } }
		});
		const [allocated] = await readAll<{ readonly id: string }>(ctx.db, 'payment_allocations', {
			payable_tranche_id: { in: tranches.map((row) => row.id) }
		});
		if (allocated != null)
			refuse('This payslip has an actual payment allocation and cannot be deleted.');
		for (const slip of stored) {
			const period = slip == null ? undefined : runById.get(slip.payroll_run_id)?.period;
			if (slip == null || period == null) continue;
			const later = slips
				.filter((other) => other.employment_id === slip.employment_id && !gone.has(other.id))
				.map((other) => runById.get(other.payroll_run_id)?.period)
				.find((other) => other != null && other > period);
			if (later != null)
				refuse(
					`This person's ${later} payslip stands on this one. Delete that later payslip first.`
				);
		}
		return inputs;
	}

	// A batch is one verb: past the delete guard every input is an update.
	const updates = inputs.flatMap((input) => ('$delete' in input ? [] : [input]));
	const paying = updates.flatMap((input, index) => {
		const slip = stored[index];
		return slip != null && input.status === 'PAID' && slip.status !== 'PAID' ? [slip] : [];
	});
	const payingEmployments = [...new Set(paying.map((slip) => slip.employment_id))];
	const affectedSlipIds = stored.flatMap((slip) => (slip == null ? [] : [slip.id]));
	// One wave: every unpaid slip of the people being paid with its run ("paid in order" is a rule about a
	// person's own pay), their disbursement holds and the declared exit needed for clearance.
	const [unpaid, runs, holds, employments, terms, companies, tranches] = await Promise.all([
		readAll<Slip>(ctx.db, 'payslips', {
			employment_id: { in: payingEmployments },
			status: { ne: 'PAID' }
		}),
		readAll<Run>(ctx.db, 'payroll_runs', {
			payslips: { some: { employment_id: { in: payingEmployments } } }
		}),
		readAll<Hold>(ctx.db, 'payment_holds', {
			employment_id: { in: payingEmployments }
		}),
		readAll<WorkspaceRow<'employments'>>(ctx.db, 'employments', {
			id: { in: payingEmployments }
		}),
		readAll<WorkspaceRow<'employment_terms'>>(ctx.db, 'employment_terms', {
			employment_id: { in: payingEmployments }
		}),
		readAll<WorkspaceRow<'companies'>>(ctx.db, 'companies', {
			employments: { some: { id: { in: payingEmployments } } }
		}),
		readAll<{
			readonly id: string;
			readonly settlement: { readonly collection: string; readonly id: string };
		}>(ctx.db, 'payable_tranches', { settlement: { payslips: { in: affectedSlipIds } } })
	]);
	const allocatedTranches = new Set(
		(
			await readAll<{ readonly payable_tranche_id: string }>(ctx.db, 'payment_allocations', {
				payable_tranche_id: { in: tranches.map((row) => row.id) }
			})
		).map((row) => row.payable_tranche_id)
	);
	const runById = new Map(runs.map((run) => [run.id, run]));
	const employeeIds = [...new Set(employments.map((row) => row.employee_id))];
	const codes = [
		...new Set(companies.map((row) => row.settings_code).filter((code) => code !== ''))
	];
	const [employees, versions] = await Promise.all([
		readAll<WorkspaceRow<'employees'>>(ctx.db, 'employees', { id: { in: employeeIds } }),
		readAll<WorkspaceRow<'jurisdiction_settings'>>(ctx.db, 'jurisdiction_settings', {
			code: { in: codes },
			sealed_at: { isNull: false },
			voided_at: { isNull: true },
			approval_id: { isNull: true }
		})
	]);

	return updates.map((input, index) => {
		const slip = stored[index];
		if (slip == null) return input;
		if (
			tranches.some((row) => row.settlement.id === slip.id && allocatedTranches.has(row.id)) &&
			(input.funding_received !== undefined ||
				input.funding_received_on !== undefined ||
				input.funding_reference !== undefined)
		)
			refuse('A partially paid payslip keeps its contribution funding evidence frozen.');
		const to = input.status ?? slip.status;
		const funding = decodeNumber(input.funding_received ?? slip.funding_received ?? 0);
		const unfunded = decodeNumber(slip.unfunded_contributions ?? 0);
		const fundingDate =
			input.funding_received_on === undefined
				? slip.funding_received_on
				: input.funding_received_on;
		const fundingReference =
			input.funding_reference === undefined ? slip.funding_reference : input.funding_reference;
		if (!Number.isFinite(funding) || funding < 0 || funding > unfunded)
			refuse('Funding received must be between zero and the unfunded contribution amount.', {
				field: 'funding_received'
			});
		if (cents(funding, slip.currency) !== funding)
			refuse('Funding received must use the payslip currency precision.', {
				field: 'funding_received'
			});
		if (funding > 0 && (fundingDate == null || !(fundingReference ?? '').trim()))
			refuse('Funding received requires its receipt date and reference.');
		const paidAt = input.paid_at === undefined ? slip.paid_at : input.paid_at;
		if (to === 'PAID' && paidAt == null)
			refuse('Marking a payslip paid needs the day it was paid.', { field: 'paid_at' });
		if (to !== 'PAID' && input.paid_at != null)
			refuse('A payslip records the day it was paid only when it is paid.', {
				field: 'paid_at'
			});
		if (to !== 'PAID' || slip.status === 'PAID') return input;
		if (
			slip.payment_mode === 'EVENT_LEDGER' ||
			tranches.some((tranche) => tranche.settlement.id === slip.id)
		)
			refuse('This payslip requires actual payment allocations before it can be settled.');
		if (slip.statutory?.some((charge) => charge.payment_occasion === true)) {
			const scheduled = runById.get(slip.payroll_run_id)?.pay_date;
			if (scheduled == null || dateKey(scheduled) !== dateKey(String(paidAt)))
				refuse(
					'Payment-occasion withholding was calculated for the run settlement date. Recalculate payroll for the actual payment date before marking this payslip paid.',
					{ field: 'paid_at' }
				);
		}
		if (funding < unfunded)
			refuse(
				'Employee statutory contributions remain unfunded. Record the funds received before settling this payslip.'
			);
		if (funding > 0 && dateKey(String(fundingDate)) > dateKey(String(paidAt)))
			refuse('The settlement date cannot precede the contribution funding receipt.', {
				field: 'paid_at'
			});
		const openHold = holds.find(
			(hold) =>
				hold.employment_id === slip.employment_id &&
				(hold.released_on == null || dateKey(hold.released_on) > dateKey(paidAt))
		);
		if (openHold != null)
			refuse(
				`Disbursement hold ${openHold.directive_reference} is open on this employment. Record the releasing directive before marking the payslip paid.`
			);
		const employment = employments.find((row) => row.id === slip.employment_id);
		const range = readRange(employment?.effective_range);
		const exit = dateKey(range?.end);
		if (employment != null && exit !== '') {
			const code = companies.find((row) => row.id === employment.company_id)?.settings_code;
			const version = code == null ? null : settingsInForce(versions, code, exit);
			if (code != null && version == null)
				refuse(`Sealed ${code} settings are missing on this employment's exit date.`);
			const clearance = version?.payroll?.tax_clearance;
			if (clearance != null) {
				const term = terms.find(
					(row) => row.employment_id === employment.id && coversDate(row.effective_range, exit)
				);
				const person = personContext({
					employee: employees.find((row) => row.id === employment.employee_id) ?? null,
					employment: {
						service_start: dateKey(range?.start),
						exit_date: exit,
						exit_reason: employment.exit_reason,
						exit_facts: employment.exit_facts
					},
					terms: term ?? null,
					asOf: exit
				});
				const declaredPerson = resolveExitFacts(
					version?.exit_facts ?? [],
					scalarFacts(employment.exit_facts),
					person
				);
				if (isEligible(clearance.when, declaredPerson)) {
					const declared = employment.exit_facts?.clearance_awareness_on;
					const awareness = dateKey(Predicate.isString(declared) ? declared : null);
					if (awareness === '')
						refuse('Tax clearance awareness date is required before a leaver can be marked paid.');
					if (
						dateKey(paidAt) >= awareness &&
						!holds.some(
							(hold) =>
								hold.employment_id === employment.id &&
								hold.category === clearance.category &&
								hold.released_on != null &&
								dateKey(hold.released_on) <= dateKey(paidAt)
						)
					)
						refuse(
							'Tax clearance requires a released hold before this payslip can be marked paid.'
						);
				}
			}
		}
		const run = runById.get(slip.payroll_run_id);
		if (run == null) return refuse('A payslip cannot be paid without its payroll run.');
		// Paid in order, per person: January's slip before February's. A colleague's unpaid January is not
		// this person's problem.
		const held = unpaid
			.filter((other) => other.employment_id === slip.employment_id && other.id !== slip.id)
			.map((other) => runById.get(other.payroll_run_id))
			.find((other) => other?.company_id === run.company_id && other.period < run.period);
		if (held != null)
			refuse(`This person's ${held.period} pay is still unpaid. Pay it before this period.`);
		return input;
	});
});

export default c;
