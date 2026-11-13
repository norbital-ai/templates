import { Effect } from 'effect';
import { automation, type ActInput } from '@norbital-ai/bolt';
import { whatsappAccount, targetOf, whatsapp } from '../lib/dispatch.js';
const REASON = {
	no_response: 'did not answer the shift check before your visit',
	declined_without_mc: 'withdrew from your shift without a medical certificate'
} as const;
/** Tells the helper of each warning filed on WhatsApp, and writes and attaches the letter where the host renders PDFs. */
export default automation({
	description:
		'Renders a PDF warning letter for each warning filed and attaches it to the warning.',
	input: { ids: { kind: 'ref', to: 'helper_warnings', many: true, min_items: 1 } },
	policies: ['dispatch_automation'],
	run: function* ({ ids }, ctx) {
		const { rows } = (yield* ctx.query({
			helper_warnings: {
				where: { id: { in: ids }, letter: { is_null: true } },
				fields: ['revision', 'reason', 'issued_at', 'helper', 'visit'],
				helper: { fields: ['name', 'phone', 'warning_count'] },
				visit: { fields: ['number', 'slot', 'address'] }
			}
		})).helper_warnings;
		const set: Extract<ActInput<'helper_warnings.update'>, readonly unknown[]>[number][] = [];
		const account = rows.length === 0 ? null : yield* whatsappAccount(ctx);
		for (const w of rows) {
			const helper = w.helper;
			if (helper === null) continue;
			if (account !== null)
				yield* ctx.send(account, {
					to: whatsapp(helper.phone),
					text: `A warning has been filed on your record: you ${REASON[w.reason]}. Please answer every shift check, and send a medical certificate whenever you cannot work for medical reasons.`
				});
			const at =
				w.visit === null
					? 'your shift'
					: `${new Intl.DateTimeFormat('en-SG', { timeZone: ctx.tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(w.visit.slot.start))}, at ${w.visit.address} (visit ${w.visit.number})`;
			const letter = yield* ctx.convert
				.document(
					{
						markdown: [
							'# Warning letter',
							new Intl.DateTimeFormat('en-SG', {
								timeZone: ctx.tz,
								dateStyle: 'medium',
								timeStyle: 'short'
							}).format(new Date(w.issued_at)),
							`Dear ${helper.name},`,
							`On ${at}, you ${REASON[w.reason]}. The visit had to be given to another helper at short notice.`,
							`This is warning ${helper.warning_count} on your record. Please answer every shift check, and send a medical certificate whenever you cannot work for medical reasons.`,
							'Operations'
						].join('\n\n')
					},
					{
						to: 'pdf',
						name: `warning-${helper.name.replace(/\W+/g, '-')}.pdf`,
						for: 'helper_warnings.letter'
					}
				)
				.pipe(Effect.catch((failure) => Effect.logWarning(failure).pipe(Effect.as(null))));
			// a host with no document converter: the warning stands without its letter
			if (letter === null) continue;
			set.push({ target: targetOf(w), set: { letter } });
		}
		if (set.length > 0) yield* ctx.act({ 'helper_warnings.update': set });
	}
});
