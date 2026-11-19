import { automation, instance_id } from '@norbital-ai/bolt';
import { BigDecimal, Effect, Schema } from 'effect';
import { businessDays } from '../lib/fx.js';
import { addDays, decimal, text } from '../lib/calculations.js';

const PATH =
	'monthly_statistical_bulletin_non610ora/exchange_rates_end_of_period_daily/views/exchange_rates_end_of_period_daily';
const KEY = /^([a-z]{3})_sgd(_100)?$/;
/** A three-letter code is a currency field's value once it is upper case. */
const isCurrency = (code: string): code is Uppercase<string> => code === code.toUpperCase();
/** The feed's answer: one element per published day, a rate per currency key. */
const Answer = Schema.Struct({
	elements: Schema.Array(Schema.Record(Schema.String, Schema.Unknown))
});

/**
 * Brings the official daily rates up to date: each of the last 15 days' weekdays without a final rate is asked for,
 * and every currency the day publishes is saved as USD per unit (crossed through SGD; per-100 quotes divided down).
 * A preliminary rate is replaced by the final one on a later run; a day with nothing published saves nothing. Runs
 * after the midday publication on weekdays, and on demand. Without a connected account it does nothing.
 */
export default automation({
	description: 'Fetch the official daily exchange rates.',
	on: [{ cron: '30 13 * * 1-5' }],
	policies: ['fx_rates'],
	run: function* (_input, ctx) {
		const { sys_integration } = yield* ctx.query({
			sys_integration: {
				where: { integration: { eq: 'mas_rates' }, active: { eq: true }, owner: { is_null: true } },
				fields: ['integration'],
				limit: 2
			}
		});
		const [account] = sys_integration.rows;
		if (account === undefined || sys_integration.rows.length !== 1)
			return yield* Effect.logWarning('No single active mas_rates account: no rates fetched.');
		const days = businessDays(addDays(ctx.today, -16), ctx.today);
		const { fx_rate } = yield* ctx.query({
			fx_rate: {
				where: { rate_date: { in: days } },
				fields: ['revision', 'currency', 'rate_date', 'preliminary'],
				limit: 5000
			}
		});
		const final = new Set(fx_rate.rows.filter((r) => !r.preliminary).map((r) => r.rate_date));
		for (const day of days.filter((d) => !final.has(d))) {
			const answer = yield* ctx.request(instance_id('mas_rates', account), {
				method: 'GET',
				path: PATH,
				query: { end_of_day: day },
				output: { kind: 'json' }
			});
			const element = (yield* Schema.decodeUnknownEffect(Answer)(answer)).elements[0];
			if (element === undefined) continue;
			const sgd = new Map<Uppercase<string>, BigDecimal.BigDecimal>([['SGD', decimal('1')]]);
			for (const [k, v] of Object.entries(element)) {
				const m = KEY.exec(k);
				const code = m?.[1]?.toUpperCase();
				const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
				if (m === null || code === undefined || !isCurrency(code) || !Number.isFinite(n) || n <= 0)
					continue;
				sgd.set(code, BigDecimal.divideUnsafe(decimal(String(v)), decimal(m[2] ? '100' : '1')));
			}
			const usd = sgd.get('USD');
			if (usd === undefined) continue;
			const preliminary = String(element['preliminary']) === '1';
			const existing = fx_rate.rows.filter((r) => r.rate_date === day);
			const rows = [...sgd].map(([currency, perUnit]) => ({
				currency,
				usd_per_unit: text(BigDecimal.divideUnsafe(perUnit, usd), 12),
				preliminary
			}));
			yield* ctx.act({
				'fx_rate.create': rows
					.filter((r) => r.currency !== 'USD' && !existing.some((e) => e.currency === r.currency))
					.map((r) => ({ ...r, rate_date: day })),
				'fx_rate.update': existing.flatMap((target) => {
					const r = rows.find((x) => x.currency === target.currency);
					return r === undefined
						? []
						: [{ target, set: { usd_per_unit: r.usd_per_unit, preliminary } }];
				})
			});
		}
	}
});
