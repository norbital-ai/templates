import { model } from '@norbital-ai/bolt';
import { refuseSealedUpdate, stripRow } from '../../../lib/payroll_engine/settings_version.js';
import { STATUTORY_FIELDS } from '../../../lib/payroll_engine/statutory_fields.js';

/** Create columns are every field a part declares, so a clone carries each one (a child's FK is its relation). */
const columnsOf = <F extends object>(fields: F) =>
	Object.keys(fields).filter((field): field is Extract<keyof F, string> =>
		Object.hasOwn(fields, field)
	);
const columns = [...columnsOf(STATUTORY_FIELDS.settings), 'cloned_from_id'] as const;
const leave_columns = columnsOf(STATUTORY_FIELDS.leave_catalog);
const claim_columns = columnsOf(STATUTORY_FIELDS.claim_catalog);
const allowance_columns = columnsOf(STATUTORY_FIELDS.allowance_catalog);
const adhoc_columns = columnsOf(STATUTORY_FIELDS.adhoc_catalog);
const loan_columns = columnsOf(STATUTORY_FIELDS.loan_catalog);
const work_columns = columnsOf(STATUTORY_FIELDS.work_catalog);
const contribution_columns = columnsOf(STATUTORY_FIELDS.statutory_contribution_catalog);
const rule_columns = columnsOf(STATUTORY_FIELDS.rule_set);
/** A new version is a draft: unsealed and live. */
const DRAFT = { sealed_at: null, voided_at: null, void_reason: null } as const;
/** The cloned version's rows of one child, narrowed to the columns its nested create declares. */
const copied = <
	R extends { readonly settings_id: unknown },
	const K extends readonly (string & keyof R)[]
>(
	rows: readonly R[],
	settings_id: unknown,
	columns: K
) => rows.filter((row) => row.settings_id === settings_id).map((row) => stripRow(row, columns));

export default model('jurisdiction_settings', {
	description:
		'One version of a jurisdiction settings lineage: general payroll data, owning its regulatory rule sets, family catalogues and schemes. Holidays belong to the entity that observes them. Sealed versions of one code never overlap; a sealed version and all its children are immutable and can only be voided.',
	icon: 'lucide:globe',
	label: 'name',
	fields: {
		...STATUTORY_FIELDS.settings,
		cloned_from_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'clones',
			optional: true,
			onDelete: 'setNull'
		}
	},
	read: 'all',
	create: {
		columns,
		with: {
			leave_catalog: { create: { columns: leave_columns } },
			claim_catalog: { create: { columns: claim_columns } },
			allowance_catalog: { create: { columns: allowance_columns } },
			adhoc_catalog: { create: { columns: adhoc_columns } },
			loan_catalog: { create: { columns: loan_columns } },
			work_catalog: { create: { columns: work_columns } },
			statutory_contribution_catalog: {
				create: { columns: contribution_columns }
			},
			rule_set: { create: { columns: rule_columns } }
		},
		/**
		 * A clone (`cloned_from_id`) carries every child of the version it clones, unless the writer sends that child
		 * itself, and its suspension kinds: every cloned version and its children read at once.
		 */
		transform: function* (rows, ctx) {
			const sources = [
				...new Set(rows.flatMap((row) => (row.cloned_from_id == null ? [] : [row.cloned_from_id])))
			];
			if (sources.length === 0) return rows.map((row) => ({ ...row, ...DRAFT }));
			const where = { settings_id: { in: sources } };
			const got = yield* ctx.db.query({
				versions: {
					from: 'jurisdiction_settings',
					where: { id: { in: sources } },
					select: { id: true, suspension_kinds: true },
					all: true
				},
				leave: { from: 'leave_catalog', where, all: true },
				claim: { from: 'claim_catalog', where, all: true },
				allowance: { from: 'allowance_catalog', where, all: true },
				adhoc: { from: 'adhoc_catalog', where, all: true },
				loan: { from: 'loan_catalog', where, all: true },
				work: { from: 'work_catalog', where, all: true },
				statutory_contribution: {
					from: 'statutory_contribution_catalog',
					where,
					all: true
				},
				rule_set: { from: 'rule_set', where, all: true }
			});
			const gone = rows.findIndex(
				(row) =>
					row.cloned_from_id != null &&
					!got.versions.rows.some((version) => version.id === row.cloned_from_id)
			);
			if (gone >= 0)
				return yield* ctx.refuse('The version this draft clones is gone.', {
					row: gone
				});
			return rows.map((row) => {
				const id = row.cloned_from_id;
				const source = got.versions.rows.find((version) => version.id === id);
				if (id == null || source === undefined) return { ...row, ...DRAFT };
				return {
					...row,
					...DRAFT,
					leave_catalog: row.leave_catalog ?? {
						create: copied(got.leave.rows, id, leave_columns)
					},
					claim_catalog: row.claim_catalog ?? {
						create: copied(got.claim.rows, id, claim_columns)
					},
					allowance_catalog: row.allowance_catalog ?? {
						create: copied(got.allowance.rows, id, allowance_columns)
					},
					adhoc_catalog: row.adhoc_catalog ?? {
						create: copied(got.adhoc.rows, id, adhoc_columns)
					},
					loan_catalog: row.loan_catalog ?? {
						create: copied(got.loan.rows, id, loan_columns)
					},
					work_catalog: row.work_catalog ?? {
						create: copied(got.work.rows, id, work_columns)
					},
					statutory_contribution_catalog: row.statutory_contribution_catalog ?? {
						create: copied(got.statutory_contribution.rows, id, contribution_columns)
					},
					rule_set: row.rule_set ?? {
						create: copied(got.rule_set.rows, id, rule_columns)
					},
					suspension_kinds: row.suspension_kinds ?? source.suspension_kinds
				};
			});
		}
	},
	update: {
		columns,
		// a sealed version only shortens or voids, once
		transform: function* (changes, ctx) {
			for (const [row, { before, set }] of changes.entries()) {
				const refusal = refuseSealedUpdate(before, set);
				if (refusal != null) return yield* ctx.refuse(refusal, { row });
			}
			return changes.map(({ set }) => set);
		}
	},
	// a discarded draft is deleted (the grant admits drafts only); a sealed version is voided
	delete: {}
});
