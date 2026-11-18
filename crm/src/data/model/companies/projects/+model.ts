import { Effect } from 'effect';
import { model } from '@norbital-ai/bolt';
import type { Actor, CreateInput, Id, StoredTree, UpdateInput, WriteCtx } from '@norbital-ai/bolt';
import {
	DECISIONS_FIELD,
	manualFields,
	markManual,
	SOW_FIELDS
} from '../../../../lib/extracted.js';

/** Every column is the person's to set; extraction writes the same scope fields as `update_requirements`. */
const columns = [
	'name',
	'capture_rules',
	'overview',
	'definitions',
	'implementation_scope',
	'data_migration',
	'milestones',
	'uat_tests',
	'fees',
	'decisions',
	'manual_fields',
	'generation_error',
	'company_id',
	'lead_contact_id',
	'signatory',
	'status',
	'target_on',
	'summary'
] as const;

type Edit = Pick<
	CreateInput<'projects'> | UpdateInput<'projects'>,
	| 'overview'
	| 'definitions'
	| 'implementation_scope'
	| 'data_migration'
	| 'milestones'
	| 'uat_tests'
	| 'fees'
	| 'decisions'
>;
/** Extraction writes as the system; a person's edit becomes manual and is never regenerated over. */
const marked = (input: Edit, before: StoredTree<'projects', 'update'> | undefined, actor: Actor) =>
	actor.kind !== 'member'
		? {}
		: {
				...(input.overview !== undefined && {
					manual_fields: manualFields(
						[{ field: 'overview', next: input.overview, before: before?.overview }],
						before?.manual_fields
					)
				}),
				...(input.definitions !== undefined && {
					definitions: markManual(input.definitions, before?.definitions)
				}),
				...(input.implementation_scope !== undefined && {
					implementation_scope: markManual(input.implementation_scope, before?.implementation_scope)
				}),
				...(input.data_migration !== undefined && {
					data_migration: markManual(input.data_migration, before?.data_migration)
				}),
				...(input.milestones !== undefined && {
					milestones: markManual(input.milestones, before?.milestones)
				}),
				...(input.uat_tests !== undefined && {
					uat_tests: markManual(input.uat_tests, before?.uat_tests)
				}),
				...(input.fees !== undefined && { fees: markManual(input.fees, before?.fees) }),
				...(input.decisions !== undefined && {
					decisions: markManual(input.decisions, before?.decisions)
				})
			};

type Signer = {
	readonly row: number;
	readonly signatory: Id<'contacts'>;
	readonly customer: Id<'companies'> | null;
};
/** The signer must be a contact of the job's customer. */
const signersBelong = Effect.fnUntraced(function* (
	signers: readonly Signer[],
	ctx: WriteCtx<'projects'>
) {
	if (signers.length === 0) return;
	const contacts = (yield* ctx.query({
		contacts: {
			where: { id: { in: [...new Set(signers.map((s) => s.signatory))] } },
			fields: ['company_id']
		}
	})).contacts;
	const wrong = signers.find(
		(s) => contacts.rows.find((row) => row.id === s.signatory)?.company_id !== s.customer
	);
	if (wrong !== undefined)
		return yield* ctx.refuse('errors.signer_not_job_customer', {
			field: 'signatory',
			row: wrong.row
		});
});

/**
 * A delivery engagement for a customer: its PIC (`lead_contact_id`) and assigned SOW signer (`signatory`), and the
 * structured scope of work and decisions `update_requirements` extracts from the job's filed activities and documents, images
 * and voice notes included. The SOW itself is never stored: it is rendered from the template catalogue and these
 * fields, and its signed copies are `signed_documents`.
 * `manual_fields` and each item's `origin` mark what a person wrote, which extraction never replaces.
 * `generation_error` is the last extraction failure, cleared on success.
 */
export default model('projects', {
	description: 'A project delivery engagement for a client company.',
	icon: 'lucide:folder-kanban',
	record_label: 'record.name',
	fields: {
		name: { kind: 'text' },
		capture_rules: { kind: 'text', format: 'markdown', optional: true, max: 8000 },
		overview: { kind: 'text', format: 'markdown', optional: true },
		...SOW_FIELDS,
		decisions: DECISIONS_FIELD,
		manual_fields: { kind: 'enum', values: ['overview'], many: true, optional: true, hidden: true },
		generation_error: { kind: 'text', optional: true },
		status: {
			kind: 'enum',
			values: ['discovery', 'in_delivery', 'uat', 'complete', 'on_hold'],
			optional: true
		},
		target_on: { kind: 'date', optional: true },
		summary: { kind: 'text', optional: true },
		company_id: { kind: 'ref', to: 'companies', inverse: 'projects', optional: true },
		lead_contact_id: { kind: 'ref', to: 'contacts', inverse: 'led_projects', optional: true },
		signatory: {
			kind: 'ref',
			to: 'contacts',
			inverse: 'signs_projects',
			optional: true,
			on_delete: 'set_null'
		}
	},
	indexes: { find: { text: ['name', 'company_id'] } },
	outputs: { default: { fields: 'all', company_id: { fields: ['name', 'uen'] } } },
	create: {
		fields: columns,
		transform: function* (changes, ctx) {
			const rows = changes.map(({ set }) => set);
			const row = rows.findIndex((input) => input.company_id == null);
			if (row >= 0)
				return yield* ctx.refuse('errors.job_needs_customer', { field: 'company_id', row });
			yield* signersBelong(
				rows.flatMap((input, row) =>
					input.signatory == null
						? []
						: [{ row, signatory: input.signatory, customer: input.company_id ?? null }]
				),
				ctx
			);
			return rows.map((input) => ({ ...input, ...marked(input, undefined, ctx.actor) }));
		}
	},
	update: {
		fields: columns,
		transform: function* (changes, ctx) {
			const row = changes.findIndex(
				({ before, set }) =>
					before.company_id != null &&
					set.company_id !== undefined &&
					set.company_id !== before.company_id
			);
			if (row >= 0)
				return yield* ctx.refuse('errors.job_customer_fixed', { field: 'company_id', row });
			yield* signersBelong(
				changes.flatMap(({ set, after }, row) =>
					set.signatory == null
						? []
						: [
								{
									row,
									signatory: set.signatory,
									customer: after.company_id
								}
							]
				),
				ctx
			);
			return changes.map(({ before, set }) => ({ ...set, ...marked(set, before, ctx.actor) }));
		},
		// changed capture rules reconsider the job's captured messages
		effect: function* (changes, ctx) {
			const ids = changes.flatMap((change) =>
				change.changed('capture_rules') ? [change.after.id] : []
			);
			if (ids.length > 0)
				yield* ctx.schedule('refresh_job_capture_rules', { ids }, { at: ctx.now });
		}
	}
});
