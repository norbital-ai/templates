import type { TransformRow } from '@norbital-ai/bolt';
import { decodeNumber } from '../../wire.js';
import type { PayrollWorld } from '../world.js';
import type { WorkspaceRow } from '../../rows.js';
import { isOrder } from '../loan.js';
import { refuse } from '../../refuse.js';
import { payrollRunPayload } from './graph.js';
import { assertPayrollRunDeletable } from './period.js';
import type { buildPayrollRun } from './engine.js';

type Run = WorkspaceRow<'payroll_runs'>;
const PINNED = [
	'work_days',
	'claim_requests',
	'adhoc_requests',
	'leave_entries',
	'loan_repayments'
] as const;

/** Release only this run's unpaid history in memory; the returned relation actions commit it atomically. */
export function rerunProjection(world: PayrollWorld, run: Run) {
	assertPayrollRunDeletable(
		world.payroll_runs.filter((row) => row.id !== run.id),
		run
	);
	const own = world.payslips.filter((row) => row.payroll_run_id === run.id);
	const unpaid = own.filter((row) => row.status !== 'PAID' && row.paid_at == null);
	if (unpaid.length === 0) refuse('This payroll run has no unpaid payslips to recalculate.');
	if (
		unpaid.some(
			(row) =>
				decodeNumber(row.funding_received ?? 0) > 0 ||
				row.funding_received_on != null ||
				String(row.funding_reference ?? '').trim() !== ''
		)
	)
		refuse('A funded payslip cannot be recalculated.');
	const ids = new Set<string>(unpaid.map((row) => row.id));
	const orderLoans = new Set<string>(world.loans.filter(isOrder).map((row) => row.id));
	const orders = world.loan_repayments.filter(
		(row) => ids.has(row.payslip_id ?? '') && orderLoans.has(row.loan_id)
	);
	const orderIds = new Set<string>(orders.map((row) => row.id));
	const projected: PayrollWorld = {
		...world,
		payroll_runs: world.payroll_runs.map((row) =>
			row.id === run.id ? { ...row, company_charges: [], company_remittances: [] } : row
		),
		payslips: world.payslips.filter((row) => !ids.has(row.id)),
		...Object.fromEntries(
			PINNED.map((family) => [
				family,
				world[family]
					.filter((row) => family !== 'loan_repayments' || !orderIds.has(row.id))
					.map((row) => (ids.has(row.payslip_id ?? '') ? { ...row, payslip_id: null } : row))
			])
		)
	};
	return { world: projected, unpaid, paid: own.filter((row) => !ids.has(row.id)), orders };
}

type Children = {
	wages: readonly { id: string; payslip_id: string }[];
	tranches: readonly { id: string; settlement: { id: string } }[];
	explanations: readonly { id: string; payslip_id: string }[];
};
/** Existing unpaid identity is stable; each capture and materialised child is replaced, never appended. */
export function rerunPayslips(
	world: PayrollWorld,
	projection: ReturnType<typeof rerunProjection>,
	built: ReturnType<typeof buildPayrollRun>,
	children: Children
) {
	const prior = new Map<string, WorkspaceRow<'payslips'>>(
		projection.unpaid.map((row) => [row.employment_id, row])
	);
	const payloads = payrollRunPayload(built) as readonly (ReturnType<
		typeof payrollRunPayload
	>[number] &
		Pick<TransformRow<'payslips'>, (typeof PINNED)[number] | 'payslip_wage_periods'>)[];
	const updates = payloads.flatMap((payload) => {
		const old = prior.get(payload.employment_id);
		if (old == null) return [];
		const relations = Object.fromEntries(
			PINNED.map((family) => {
				const action = payload[family] ?? {};
				const retained = new Set<string>(action.link ?? []);
				const unlink = world[family]
					.filter(
						(row) =>
							row.payslip_id === old.id &&
							!retained.has(row.id) &&
							!projection.orders.some((order) => order.id === row.id)
					)
					.map((row) => row.id);
				return [
					family,
					{
						...action,
						...(unlink.length === 0 ? {} : { unlink }),
						...(family === 'loan_repayments'
							? {
									delete: projection.orders
										.filter((row) => row.payslip_id === old.id)
										.map((row) => row.id)
								}
							: {})
					}
				];
			})
		);
		return [
			{
				target: old.id,
				set: {
					...payload,
					...relations,
					payslip_wage_periods: {
						...payload.payslip_wage_periods,
						delete: children.wages.filter((row) => row.payslip_id === old.id).map((row) => row.id)
					},
					payable_tranches: {
						delete: children.tranches
							.filter((row) => row.settlement.id === old.id)
							.map((row) => row.id)
					},
					payslip_explanations: {
						delete: children.explanations
							.filter((row) => row.payslip_id === old.id)
							.map((row) => row.id)
					}
				}
			}
		];
	});
	const rebuilt = new Set(payloads.map((row) => row.employment_id));
	const missing = projection.unpaid.filter((row) => !rebuilt.has(row.employment_id));
	// Keeping a no-longer-eligible stale salary would conceal an exit; require explicit draft removal instead.
	if (missing.length > 0)
		refuse(
			'An unpaid employment is no longer eligible for this run. Remove its draft payslip before recalculating.'
		);
	return { update: updates, create: payloads.filter((row) => !prior.has(row.employment_id)) };
}
