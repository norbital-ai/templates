import { automation } from '@norbital-ai/bolt';
import { when, whatsapp } from '../lib/dispatch.js';

const REASON = {
	no_response: 'did not answer the shift check before your visit',
	declined_without_mc: 'withdrew from your shift without a medical certificate'
} as const;

/** Tells the helper of each warning filed on WhatsApp, and writes and attaches the letter where the host renders PDFs. */
const warning_letter = automation({
	description:
		'Renders a PDF warning letter for each warning filed and attaches it to the warning.',
	on: { created: 'helper_warnings' },
	runAs: ['dispatch_automation']
});
export default warning_letter;

warning_letter.run(async ({ ids }, ctx) => {
	const { rows } = await ctx.read('helper_warnings', {
		where: { id: { in: ids }, letter: { isNull: true } },
		select: {
			reason: true,
			issued_at: true,
			helper: { select: { name: true, phone: true, warning_count: true } },
			visit: { select: { number: true, slot: true, address: true } }
		},
		all: true
	});
	const set = [];
	for (const w of rows) {
		await ctx.send('whatsapp', {
			to: whatsapp(w.helper.phone),
			text: `A warning has been filed on your record: you ${REASON[w.reason]}. Please answer every shift check, and send a medical certificate whenever you cannot work for medical reasons.`
		});
		const letter = await ctx.files.pdf.try(
			{
				blocks: [
					{ text: 'Warning letter', size: 18, bold: true },
					{ text: when(w.issued_at, ctx.tz) },
					{ spacer: 12 },
					{ text: `Dear ${w.helper.name},` },
					{
						text: `On ${w.visit === null ? 'your shift' : `${when(w.visit.slot.start, ctx.tz)}, at ${w.visit.address} (visit ${w.visit.number})`}, you ${REASON[w.reason]}. The visit had to be given to another helper at short notice.`
					},
					{
						text: `This is warning ${w.helper.warning_count} on your record. Please answer every shift check, and send a medical certificate whenever you cannot work for medical reasons.`
					},
					{ spacer: 12 },
					{ text: 'Operations' }
				]
			},
			{ name: `warning-${w.helper.name.replace(/\W+/g, '-')}.pdf`, for: 'helper_warnings.letter' }
		);
		// a host with no PDF renderer: the warning stands without its letter
		if (!('id' in letter)) continue;
		set.push({ target: w.id, set: { letter } });
	}
	if (set.length > 0) await ctx.act('helper_warnings.update', set);
});
