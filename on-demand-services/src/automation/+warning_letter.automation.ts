import { Effect } from 'effect';
import { automation, type ActInput } from '@norbital-ai/bolt';
import { when, whatsapp } from '../lib/dispatch.js';
const REASON = {
	no_response: 'did not answer the shift check before your visit',
	declined_without_mc: 'withdrew from your shift without a medical certificate'
} as const;
/** Tells the helper of each warning filed on WhatsApp, and writes and attaches the letter where the host renders PDFs. */
export default automation('warning_letter', {
	description:
		'Renders a PDF warning letter for each warning filed and attaches it to the warning.',
	on: { created: 'helper_warnings' },
	runAs: ['dispatch_automation'],
	run: function* ({ ids }, ctx) {
		const { rows } = (yield* ctx.query({
			helper_warnings: {
				where: { id: { in: ids }, letter: { isNull: true } },
				fields: ['reason', 'issued_at', 'helper', 'visit']
			},
			'helper_warnings.helper': { fields: ['name', 'phone', 'warning_count'] },
			'helper_warnings.visit': { fields: ['number', 'slot', 'address'] }
		})).helper_warnings;
		const set: Extract<ActInput<'helper_warnings.update'>, readonly unknown[]>[number][] = [];
		for (const w of rows) {
			const helper = w.helper;
			if (helper === null) continue;
			yield* ctx.send('whatsapp', {
				to: whatsapp(helper.phone),
				text: `A warning has been filed on your record: you ${REASON[w.reason]}. Please answer every shift check, and send a medical certificate whenever you cannot work for medical reasons.`
			});
			const at =
				w.visit === null
					? 'your shift'
					: `${when(w.visit.slot.start, ctx.tz)}, at ${w.visit.address} (visit ${w.visit.number})`;
			const letter = yield* ctx.convert
				.document(
					{
						markdown: [
							'# Warning letter',
							when(w.issued_at, ctx.tz),
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
			set.push({ target: w.id, set: { letter } });
		}
		if (set.length > 0) yield* ctx.act('helper_warnings.update', set);
	}
});
