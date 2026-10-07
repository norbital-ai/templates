import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { refuseSealedUpdate, stripRow } from '../../../../lib/payroll_engine/settings_version.js';

const create_columns = [
	'code',
	'jurisdiction_code',
	'name',
	'employee_input_schema',
	'entity_input_schema',
	'behaviours',
	'sealed_at',
	'voided_at',
	'void_reason',
	'payroll',
	'change_summary',
	'effective_range',
	'sources',
	'reference_tables',
	'cloned_from_id'
] as const;

const leave_columns = [
	'code',
	'name',
	'description',
	'authority',
	'eligibility',
	'evidence',
	'unit',
	'can_encash',
	'encash_on_exit',
	'entitlement',
	'schedule',
	'is_npl',
	'preceding_leave_same_event',
	'preceding_leave_contiguous',
	'requires_no_pay_origin',
	'pay_fraction',
	'paid_by',
	'evidence_after_days',
	'consumes_code'
] as const;
const claim_columns = [
	'code',
	'name',
	'authority',
	'destination',
	'direction',
	'bands',
	'eligibility',
	'qualifies_when',
	'evidence',
	'counts_toward',
	'leave_code',
	'unit_cap',
	'claim_window_months',
	'employer_premium_scheme',
	'minimum_service_months'
] as const;
const allowance_columns = [
	'code',
	'name',
	'eligibility',
	'authority',
	'counts_toward',
	'destination',
	'direction'
] as const;
const adhoc_columns = [
	'code',
	'name',
	'authority',
	'destination',
	'direction',
	'bands',
	'eligibility',
	'qualifies_when',
	'evidence',
	'counts_toward',
	'raised_by',
	'schedule'
] as const;
const loan_columns = [
	'code',
	'name',
	'destination',
	'direction',
	'bands',
	'loan_type',
	'minimum_repayment',
	'approval_reference_required',
	'order_recovery_rule',
	'order_payment_when',
	'order_authority',
	'eligibility',
	'evidence'
] as const;
const work_columns = [
	'code',
	'name',
	'authority',
	'component_code',
	'eligibility',
	'quantity',
	'rate',
	'destination',
	'direction',
	'counts_toward'
] as const;
const contribution_columns = ['code', 'name', 'authority', 'configuration'] as const;
const rule_columns = [
	'scope',
	'family',
	'code',
	'name',
	'content_hash',
	'source_identity',
	'rules'
] as const;

const c = collection('jurisdiction_settings', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: create_columns,
			with: {
				leave_catalog: { create: { columns: leave_columns } },
				claim_catalog: { create: { columns: claim_columns } },
				allowance_catalog: { create: { columns: allowance_columns } },
				adhoc_catalog: { create: { columns: adhoc_columns } },
				loan_catalog: { create: { columns: loan_columns } },
				work_catalog: { create: { columns: work_columns } },
				statutory_contribution_catalog: { create: { columns: contribution_columns } },
				rule_set: { create: { columns: rule_columns } }
			}
		}
	},
	update: { input: { columns: create_columns } }
});
export default c;

c.transform(async (inputs, ctx: TransformCtx<'jurisdiction_settings'>) => {
	const out = [];
	for (const [i, input] of inputs.entries()) {
		const existing = ctx.existing[i];
		if (existing !== undefined) {
			if ('$delete' in input) {
				out.push(input);
				continue;
			}
			const refusal = refuseSealedUpdate(existing, input);
			if (refusal != null) ctx.refuse(refusal);
			out.push(input);
			continue;
		}
		const fromId = 'cloned_from_id' in input ? input.cloned_from_id : null;
		if (fromId == null) {
			out.push({ ...input, sealed_at: null, voided_at: null, void_reason: null });
			continue;
		}
		const source = (
			await ctx.db.read('jurisdiction_settings', {
				where: { id: { eq: fromId } },
				select: { id: true, effective_range: true, sealed_at: true, voided_at: true },
				all: true
			})
		).rows[0];
		if (source == null) ctx.refuse('The version this draft clones is gone.');
		const catalogWhere = {
			settings_id: { eq: fromId },
			approval_id: { isNull: true }
		};
		const [leave, claim, allowance, adhoc, loan, work, statutory_contribution, rule_set] =
			await Promise.all([
				ctx.db.read('leave_catalog', {
					where: catalogWhere,
					select: {
						code: true,
						name: true,
						description: true,
						authority: true,
						eligibility: true,
						evidence: true,
						unit: true,
						can_encash: true,
						encash_on_exit: true,
						entitlement: true,
						schedule: true,
						is_npl: true,
						preceding_leave_same_event: true,
						preceding_leave_contiguous: true,
						requires_no_pay_origin: true,
						pay_fraction: true,
						paid_by: true,
						evidence_after_days: true,
						consumes_code: true
					},
					all: true
				}),
				ctx.db.read('claim_catalog', {
					where: catalogWhere,
					select: {
						code: true,
						name: true,
						authority: true,
						destination: true,
						direction: true,
						bands: true,
						eligibility: true,
						qualifies_when: true,
						evidence: true,
						counts_toward: true,
						leave_code: true,
						unit_cap: true,
						claim_window_months: true,
						employer_premium_scheme: true,
						minimum_service_months: true
					},
					all: true
				}),
				ctx.db.read('allowance_catalog', {
					where: catalogWhere,
					select: {
						code: true,
						name: true,
						eligibility: true,
						authority: true,
						counts_toward: true,
						destination: true,
						direction: true
					},
					all: true
				}),
				ctx.db.read('adhoc_catalog', {
					where: catalogWhere,
					select: {
						code: true,
						name: true,
						authority: true,
						destination: true,
						direction: true,
						bands: true,
						eligibility: true,
						qualifies_when: true,
						evidence: true,
						counts_toward: true,
						raised_by: true,
						schedule: true
					},
					all: true
				}),
				ctx.db.read('loan_catalog', {
					where: catalogWhere,
					select: {
						code: true,
						name: true,
						destination: true,
						direction: true,
						bands: true,
						loan_type: true,
						minimum_repayment: true,
						approval_reference_required: true,
						order_recovery_rule: true,
						order_payment_when: true,
						order_authority: true,
						eligibility: true,
						evidence: true
					},
					all: true
				}),
				ctx.db.read('work_catalog', {
					where: catalogWhere,
					select: {
						code: true,
						name: true,
						authority: true,
						component_code: true,
						eligibility: true,
						quantity: true,
						rate: true,
						destination: true,
						direction: true,
						counts_toward: true
					},
					all: true
				}),
				ctx.db.read('statutory_contribution_catalog', {
					where: catalogWhere,
					select: {
						code: true,
						name: true,
						authority: true,
						configuration: true
					},
					all: true
				}),
				ctx.db.read('rule_set', {
					where: catalogWhere,
					select: {
						scope: true,
						family: true,
						code: true,
						name: true,
						content_hash: true,
						source_identity: true,
						rules: true
					},
					all: true
				})
			]);
		out.push({
			...input,
			sealed_at: null,
			voided_at: null,
			void_reason: null,
			leave_catalog: {
				create: leave.rows.map((row) => stripRow(row, leave_columns))
			},
			claim_catalog: {
				create: claim.rows.map((row) => stripRow(row, claim_columns))
			},
			allowance_catalog: {
				create: allowance.rows.map((row) => stripRow(row, allowance_columns))
			},
			adhoc_catalog: {
				create: adhoc.rows.map((row) => stripRow(row, adhoc_columns))
			},
			loan_catalog: {
				create: loan.rows.map((row) => stripRow(row, loan_columns))
			},
			work_catalog: {
				create: work.rows.map((row) => stripRow(row, work_columns))
			},
			statutory_contribution_catalog: {
				create: statutory_contribution.rows.map((row) => stripRow(row, contribution_columns))
			},
			rule_set: {
				create: rule_set.rows.map((row) => stripRow(row, rule_columns))
			}
		});
	}
	return out;
});
