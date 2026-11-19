import { automation } from '@norbital-ai/bolt';
import { Effect, Result } from 'effect';
import { blank, documentSource } from '../lib/documents.js';
import { dealFrom, FX_PROPOSAL_READ, refKey, schedule } from '../lib/fx.js';

const SYSTEM = [
	"You read a banker's FX hedge proposal: an email, chat message or file offering one or more alternatives.",
	'Banker shorthand: K is the strike, KO the knock-out, KI the knock-in, mio a million, m months, lev leverage.',
	'Give one alternative per option with its label (for example "Option 1 – strike 1.3150").',
	'pair is six letters, the base currency first; side is whether the company sells or buys the base currency.',
	'target is in quote currency per unit of base: 100 pips is 0.0100 on USD/SGD and 1.00 on USD/JPY; leveraged_notional is an amount, so a leverage of 2x on 300k is 600000.',
	'knock_out_type is continuous when the knock-out can trigger at any time, at_expiry when only on a fixing date.',
	'Copy what is printed; never calculate or guess. List fixing dates only when printed; otherwise give the schedule',
	'(frequency, first and last fixing, count) only as stated, and never invent dates.'
].join(' ');

/**
 * Reads a banker's proposal, scheduled when it is pasted or attached: each alternative becomes a proposal deal
 * beside it, with its listed fixing dates or dates worked out from its schedule (noted for a person to check).
 * Reading again replaces the alternatives still in proposal; traded ones stay.
 */
export default automation({
	description: "Turn a banker's FX proposal into alternatives to weigh.",
	input: { proposal: { kind: 'ref', to: 'fx_proposal', many: true, optional: true } },
	policies: ['fx_reader'],
	run: function* ({ proposal }, ctx) {
		const { fx_proposal, bank } = yield* ctx.query({
			fx_proposal: {
				where: proposal == null ? { read_status: { eq: 'uploaded' } } : { id: { in: proposal } },
				fields: ['revision', 'title', 'bank', 'text', 'file'],
				limit: 100
			},
			bank: { fields: ['code', 'name'], limit: 200 }
		});
		const banks = bank.rows.map((b) => `${b.code}: ${b.name}`).join('\n');
		const failures = [];
		for (const p of fx_proposal.rows) {
			const parsed = yield* Effect.gen(function* () {
				const source =
					p.file === null
						? { text: '', files: [] }
						: yield* documentSource(p.file, 'fx_proposal_read', ctx);
				return yield* ctx.ai.sys_2.infer({
					label: 'fx proposal',
					system: SYSTEM,
					prompt: `Today is ${ctx.today}. Set bank_code to the bank's code from this list, or leave it empty:\n${banks}\n\n${p.text ?? ''}\n\n${source.text}`,
					files: source.files,
					output: FX_PROPOSAL_READ
				});
			}).pipe(Effect.result);
			if (Result.isFailure(parsed)) {
				yield* ctx.act({
					'fx_proposal.update': [
						{ target: p, set: { read_status: 'failed', read_note: parsed.failure.message } }
					]
				});
				failures.push(parsed.failure);
				continue;
			}
			const { fx_deal } = yield* ctx.query({
				fx_deal: {
					where: { proposal: { eq: p.id }, status: { eq: 'proposal' } },
					fields: ['revision']
				}
			});
			const alternatives = parsed.success.alternatives.flatMap((a) => {
				const { pair, terms, fixings } = dealFrom(a);
				if (pair === null) return [];
				const dates =
					fixings.length > 0 || a.frequency == null
						? []
						: schedule(
								a.frequency,
								ctx.today,
								a.first_fixing ?? null,
								a.last_fixing ?? null,
								a.count ?? null
							);
				return [
					{
						...terms,
						pair,
						status: 'proposal' as const,
						proposal: p.id,
						bank:
							p.bank ?? bank.rows.find((b) => refKey(b.code) === refKey(a.bank_code))?.id ?? null,
						notes: a.label ?? null,
						fixings:
							fixings.length > 0
								? fixings
								: dates.map((fixing_date) => ({
										fixing_date,
										note: "Date worked out from the proposal's schedule; check it."
									}))
					}
				];
			});
			const first = parsed.success.alternatives[0];
			const code = bank.rows.find((b) => b.id === (alternatives[0]?.bank ?? null))?.code;
			const title = [code, first?.pair?.toUpperCase(), first?.structure_as_written]
				.filter(Boolean)
				.join(' ');
			yield* ctx.act({
				...(fx_deal.rows.length === 0
					? {}
					: { 'fx_deal.delete': fx_deal.rows.map((target) => ({ target })) }),
				...(alternatives.length === 0 ? {} : { 'fx_deal.create': alternatives }),
				'fx_proposal.update': [
					{
						target: p,
						set: {
							title: blank(p.title, title === '' ? null : title),
							read_status: 'checked' as const,
							read_note:
								alternatives.length === 0
									? 'No alternative with a currency pair was found; check the proposal.'
									: (parsed.success.uncertain ?? []).join('\n') || null
						}
					}
				]
			});
		}
		if (failures[0] !== undefined) return yield* Effect.fail(failures[0]);
	}
});
