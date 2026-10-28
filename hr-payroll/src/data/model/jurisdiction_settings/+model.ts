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
const copied = <R extends object, const K extends readonly (string & keyof R)[]>(
	rows: readonly R[],
	columns: K
) => rows.map((row) => stripRow(row, columns));

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
	read: {
		jurisdiction_settings: { fields: 'all' },
		'jurisdiction_settings.statutory_contribution_catalog': { fields: 'all' },
		'jurisdiction_settings.work_catalog': { fields: 'all' },
		'jurisdiction_settings.allowance_catalog': { fields: 'all' },
		'jurisdiction_settings.adhoc_catalog': { fields: 'all' },
		'jurisdiction_settings.claim_catalog': { fields: 'all' },
		'jurisdiction_settings.leave_catalog': { fields: 'all' },
		'jurisdiction_settings.loan_catalog': { fields: 'all' },
		'jurisdiction_settings.rule_set': { fields: 'all' },
		'jurisdiction_settings.payroll_run': { fields: ['id'] }
	},
	create: {
		columns: {
			jurisdiction_settings: columns,
			'jurisdiction_settings.leave_catalog': leave_columns,
			'jurisdiction_settings.claim_catalog': claim_columns,
			'jurisdiction_settings.allowance_catalog': allowance_columns,
			'jurisdiction_settings.adhoc_catalog': adhoc_columns,
			'jurisdiction_settings.loan_catalog': loan_columns,
			'jurisdiction_settings.work_catalog': work_columns,
			'jurisdiction_settings.statutory_contribution_catalog': contribution_columns,
			'jurisdiction_settings.rule_set': rule_columns
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
			const { jurisdiction_settings: versions } = yield* ctx.db.query({
				jurisdiction_settings: { where: { id: { in: sources } } },
				'jurisdiction_settings.leave_catalog': {},
				'jurisdiction_settings.claim_catalog': {},
				'jurisdiction_settings.allowance_catalog': {},
				'jurisdiction_settings.adhoc_catalog': {},
				'jurisdiction_settings.loan_catalog': {},
				'jurisdiction_settings.work_catalog': {},
				'jurisdiction_settings.statutory_contribution_catalog': {},
				'jurisdiction_settings.rule_set': {}
			});
			const gone = rows.findIndex(
				(row) =>
					row.cloned_from_id != null &&
					!versions.rows.some((version) => version.id === row.cloned_from_id)
			);
			if (gone >= 0)
				return yield* ctx.refuse('The version this draft clones is gone.', {
					row: gone
				});
			return rows.map((row) => {
				const source = versions.rows.find((version) => version.id === row.cloned_from_id);
				if (source === undefined) return { ...row, ...DRAFT };
				return {
					...row,
					...DRAFT,
					leave_catalog: row.leave_catalog ?? copied(source.leave_catalog, leave_columns),
					claim_catalog: row.claim_catalog ?? copied(source.claim_catalog, claim_columns),
					allowance_catalog:
						row.allowance_catalog ?? copied(source.allowance_catalog, allowance_columns),
					adhoc_catalog: row.adhoc_catalog ?? copied(source.adhoc_catalog, adhoc_columns),
					loan_catalog: row.loan_catalog ?? copied(source.loan_catalog, loan_columns),
					work_catalog: row.work_catalog ?? copied(source.work_catalog, work_columns),
					statutory_contribution_catalog:
						row.statutory_contribution_catalog ??
						copied(source.statutory_contribution_catalog, contribution_columns),
					rule_set: row.rule_set ?? copied(source.rule_set, rule_columns),
					suspension_kinds: row.suspension_kinds ?? source.suspension_kinds
				};
			});
		}
	},
	update: {
		columns: { jurisdiction_settings: columns },
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
