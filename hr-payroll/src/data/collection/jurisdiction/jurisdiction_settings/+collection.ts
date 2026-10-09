import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { refuseSealedUpdate, stripRow } from '../../../../lib/payroll_engine/settings_version.js';
import adhoc_catalog from '../../../model/jurisdiction/adhoc_catalog/+model.js';
import allowance_catalog from '../../../model/jurisdiction/allowance_catalog/+model.js';
import jurisdiction_settings from '../../../model/jurisdiction/jurisdiction_settings/+model.js';
import claim_catalog from '../../../model/jurisdiction/claim_catalog/+model.js';
import leave_catalog from '../../../model/jurisdiction/leave_catalog/+model.js';
import loan_catalog from '../../../model/jurisdiction/loan_catalog/+model.js';
import rule_set_model from '../../../model/jurisdiction/rule_set/+model.js';
import statutory_contribution_catalog from '../../../model/jurisdiction/statutory_contribution_catalog/+model.js';
import suspension_kind from '../../../model/jurisdiction/suspension_kind/+model.js';
import work_catalog from '../../../model/jurisdiction/work_catalog/+model.js';

/** Create columns are every field a model declares, so a clone carries each one (a child's FK is its relation). */
const columnsOf = <F extends object>(spec: { readonly fields: F }) =>
	Object.keys(spec.fields) as Extract<keyof F, string>[];
const create_columns = [...columnsOf(jurisdiction_settings), 'cloned_from_id'] as const;
const leave_columns = columnsOf(leave_catalog);
const claim_columns = columnsOf(claim_catalog);
const allowance_columns = columnsOf(allowance_catalog);
const adhoc_columns = columnsOf(adhoc_catalog);
const loan_columns = columnsOf(loan_catalog);
const work_columns = columnsOf(work_catalog);
const contribution_columns = columnsOf(statutory_contribution_catalog);
const suspension_columns = columnsOf(suspension_kind);
const rule_columns = columnsOf(rule_set_model);

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
				suspension_kind: { create: { columns: suspension_columns } },
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
		const read = { where: catalogWhere, all: true } as const;
		const [
			leave,
			claim,
			allowance,
			adhoc,
			loan,
			work,
			statutory_contribution,
			rule_set,
			suspension
		] = await Promise.all([
			ctx.db.read('leave_catalog', read),
			ctx.db.read('claim_catalog', read),
			ctx.db.read('allowance_catalog', read),
			ctx.db.read('adhoc_catalog', read),
			ctx.db.read('loan_catalog', read),
			ctx.db.read('work_catalog', read),
			ctx.db.read('statutory_contribution_catalog', read),
			ctx.db.read('rule_set', read),
			ctx.db.read('suspension_kind', read)
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
			},
			suspension_kind: {
				create: suspension.rows.map((row) => stripRow(row, suspension_columns))
			}
		});
	}
	return out;
});
