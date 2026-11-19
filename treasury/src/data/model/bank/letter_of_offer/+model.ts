import { model, type Id, type WriteCtx } from '@norbital-ai/bolt';
/**
 * A bank's letter of offer for a facility: the dates that matter and the PDF itself. Its next review date becomes its
 * facility's review date, which the review alert follows.
 */
export default model('letter_of_offer', {
	description: 'A letter of offer from a bank, with its review date.',
	icon: 'lucide:file-signature',
	record_label: 'record.title',
	fields: {
		bank: { kind: 'ref', to: 'bank', inverse: 'letters_of_offer' },
		facility: {
			kind: 'ref',
			to: 'facility',
			inverse: 'letters_of_offer',
			optional: true,
			on_delete: 'set_null'
		},
		title: { kind: 'text' },
		offer_date: { kind: 'date', optional: true },
		next_review_date: { kind: 'date', optional: true },
		document: {
			kind: 'file',
			accept: ['application/pdf'],
			max: '10MiB',
			optional: true
		},
		notes: { kind: 'text', optional: true }
	},
	outputs: {
		default: { fields: 'all', bank: { fields: ['code'] } }
	},
	create: {
		fields: ['bank', 'facility', 'title', 'offer_date', 'next_review_date', 'document', 'notes'],
		transform: function* (changes, ctx) {
			return { sets: changes.map((c) => c.set), with: yield* reviewDates(changes, ctx) };
		}
	},
	update: {
		fields: ['bank', 'facility', 'title', 'offer_date', 'next_review_date', 'document', 'notes'],
		transform: function* (changes, ctx) {
			return { sets: changes.map((c) => c.set), with: yield* reviewDates(changes, ctx) };
		}
	}
});

/** Each facility takes the next review date of the letter saved for it. */
function* reviewDates(
	changes: readonly {
		readonly after: {
			readonly facility?: Id<'facility'> | null;
			readonly next_review_date?: string | null;
		};
	}[],
	ctx: WriteCtx<'letter_of_offer'>
) {
	const next = new Map<Id<'facility'>, string>();
	for (const { after } of changes)
		if (after.facility != null && after.next_review_date != null)
			next.set(after.facility, after.next_review_date);
	if (next.size === 0) return {};
	const { facility } = yield* ctx.query({
		facility: { where: { id: { in: [...next.keys()] } }, fields: ['revision', 'review_date'] }
	});
	const update = facility.rows
		.filter((f) => f.review_date !== next.get(f.id))
		.map((target) => ({ target, set: { review_date: next.get(target.id) ?? null } }));
	return update.length === 0 ? {} : { facility: { update } };
}
