import { model, type EffectCtx, type Row } from '@norbital-ai/bolt';

/**
 * A banker's hedge proposal, pasted from an email or chat or attached as a PDF or picture. Reading it turns each
 * alternative into a proposal deal beside it, with the fixing dates it lists or its schedule worked out; "we traded
 * this" makes one a deal to confirm. Reading again replaces the alternatives not traded.
 */
export default model('fx_proposal', {
	description: "A banker's FX hedge proposal and its alternatives.",
	icon: 'lucide:lightbulb',
	record_label: "record.title != null ? record.title : 'Proposal'",
	fields: {
		title: { kind: 'text', optional: true },
		bank: {
			kind: 'ref',
			to: 'bank',
			inverse: 'fx_proposals',
			optional: true,
			on_delete: 'set_null'
		},
		text: { kind: 'text', optional: true },
		file: {
			kind: 'file',
			accept: ['application/pdf', 'image/jpeg', 'image/png'],
			max: '10MiB',
			optional: true
		},
		read_status: { kind: 'enum', values: ['uploaded', 'checked', 'failed'], default: 'uploaded' },
		read_note: { kind: 'text', optional: true }
	},
	outputs: {
		default: {
			fields: 'all',
			bank: { fields: ['code'] },
			alternatives: {
				fields: ['pair', 'structure', 'side', 'strike', 'knock_out', 'target', 'status', 'notes']
			}
		}
	},
	create: {
		fields: ['title', 'bank', 'text', 'file'],
		transform: function* (changes, ctx) {
			const row = changes.findIndex(
				(c) => (c.after.text ?? null) === null && (c.after.file ?? null) === null
			);
			if (row >= 0) return yield* ctx.refuse('errors.fx_proposal_empty', { row });
			return changes.map((c) => c.set);
		},
		effect: function* (changes, ctx) {
			yield* read(
				changes.map(({ after }) => after),
				ctx
			);
		}
	},
	update: {
		fields: ['title', 'bank', 'text', 'file', 'read_status', 'read_note'],
		effect: function* (changes, ctx) {
			yield* read(
				changes
					.filter(
						(c) =>
							c.changed('text') ||
							c.changed('file') ||
							(c.changed('read_status') && c.after.read_status === 'uploaded')
					)
					.map(({ after }) => after),
				ctx
			);
		}
	},
	delete: {}
});

function* read(
	rows: readonly Pick<Row<'fx_proposal'>, 'id' | 'revision'>[],
	ctx: EffectCtx<'fx_proposal'>
) {
	for (const r of rows)
		yield* ctx.schedule(
			'fx_proposal_read',
			{ proposal: [r.id] },
			{ key: `read:${r.id}:${r.revision}` }
		);
}
