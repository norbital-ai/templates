import { Effect, Predicate, Schema } from 'effect';
import { JobResult, TestWorkspace, expect, it } from '@norbital-ai/bolt-cli/test';
import { id_of } from '@norbital-ai/bolt';
import type { Provider } from '@norbital-ai/bolt/engine';
import { ActRefused } from '@norbital-ai/bolt/errors';
import { Decimal } from '@norbital-ai/std/decimal';

const root = new URL('..', import.meta.url).pathname;

/** A stored decimal equal to `expected`. */
const decimal = (expected: number) => ({
	asymmetricMatch: (value: unknown) => value instanceof Decimal && value.to_number() === expected,
	toString: () => `Decimal(${expected})`
});
const answer = (value: object) => ({
	content: JSON.stringify(value),
	tool_calls: [],
	finish: 'stop' as const,
	usage: { input: 0, output: 0 }
});
const market = answer({
	summary: 'The book held its value.',
	market_view: 'Rates are steady and equities firm.'
});
const hold = answer({ call: 'hold', analysis: 'Backlog is the swing factor.', confidence: 0.6 });
const watch = answer({ call: 'watch', analysis: 'Duration risk is the watch item.' });

it.layer(TestWorkspace.layer({ root }))('the book', (it) => {
	it.effect('an owner adds a holding; a viewer reads the book but cannot', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const owner = yield* t.as(t.member(['portfolio_manage']));
			const viewer = yield* t.as(t.member(['portfolio_read']));
			const gold = {
				instrument: 'Gold bar',
				asset_class: 'metal',
				currency: 'USD',
				value_base: 900
			} as const;
			yield* owner.act({ 'holding.create': [gold] });
			const refused = yield* Effect.flip(viewer.act({ 'holding.create': [gold] }));
			expect(refused).toBeInstanceOf(ActRefused);
			expect(
				yield* viewer.query({
					holding: { where: { asset_class: { eq: 'metal' } }, fields: ['instrument'] }
				})
			).toMatchObject({ holding: { rows: [{ instrument: 'Gold bar' }] } });
		})
	);

	it.effect('a loan is owed and a day has one report', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const owner = yield* t.as(t.member(['portfolio_manage']));
			const loan = yield* Effect.flip(
				owner.act({
					'holding.create': [
						{ instrument: 'Bridge loan', asset_class: 'loan', currency: 'USD', value_base: 500 }
					]
				})
			);
			expect(loan).toMatchObject({ _tag: 'ActRefused', key: 'errors.loan_is_owed' });

			const report = {
				for_date: '2026-11-01',
				base_currency: 'USD',
				headline: 'Draft',
				summary: 'Draft',
				net_assets: 1,
				invested: 1,
				cash: 0,
				liabilities: 0
			} as const;
			yield* owner.act({ 'report.create': [report] });
			const twice = yield* Effect.flip(owner.act({ 'report.create': [report] }));
			expect(twice).toMatchObject({ _tag: 'ActRefused', key: 'errors.report_exists' });
		})
	);
});

it.layer(
	TestWorkspace.layer({
		root,
		now: '2026-11-02T12:00:00.000Z',
		fakes: { ai: { cassette: { default: [market, hold, watch, market, hold, watch] } } }
	})
)('the daily agent', (it) => {
	it.effect('files the report, one call per position and the day’s P&L', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const owner = yield* t.as(t.member(['portfolio_manage']));
			t.clock.set('2026-11-02T13:01:00.000Z');
			const { failed } = yield* t.run_due();
			expect(failed).toEqual([]);

			expect(yield* owner.query({ report: { limit: 10 } })).toMatchObject({
				report: {
					rows: [
						{
							for_date: '2026-11-02',
							net_assets: decimal(18100),
							liabilities: decimal(2000),
							market_view: 'Rates are steady and equities firm.',
							positions: [
								{ instrument: 'Acme Robotics Inc', call: 'hold' },
								{ instrument: 'Global Bond Index Fund', call: 'watch' }
							]
						}
					]
				}
			});
			expect(
				yield* owner.query({ holding: { where: { symbol: { eq: 'ACME UW' } } } })
			).toMatchObject({
				holding: {
					rows: [
						{
							research_summary: 'Backlog is the swing factor.',
							pnl_history: [{ date: '2026-11-02', pnl: decimal(2000) }]
						}
					]
				}
			});
		})
	);

	it.effect('a second run on the day rewrites that day’s report and P&L entry', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const owner = yield* t.as(t.member(['portfolio_manage']));
			const started = yield* owner.run('portfolio_agent', {}, JobResult);
			expect(started.kind).toBe('committed');
			const { failed } = yield* t.run_due();
			expect(failed).toEqual([]);

			const reports = yield* owner.query({ report: { fields: ['for_date'], limit: 10 } });
			expect(reports).toMatchObject({ report: { rows: [{ for_date: '2026-11-02' }] } });
			expect(
				yield* owner.query({
					holding: { where: { symbol: { eq: 'ACME UW' } }, fields: ['pnl_history'] }
				})
			).toMatchObject({ holding: { rows: [{ pnl_history: [{ date: '2026-11-02' }] }] } });
		})
	);

	it.effect('a viewer may not start the agent', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const viewer = yield* t.as(t.member(['portfolio_read']));
			const refused = yield* Effect.flip(viewer.run('portfolio_agent', {}, JobResult));
			expect(refused).toBeInstanceOf(ActRefused);
		})
	);
});

/** A WhatsApp provider that pairs on `{ key }`, as a real one writes its credential and connected status. */
const whatsapp: Provider = {
	driver: 'whatsapp',
	id: 'fake',
	label: 'Fake',
	setup: { kind: 'form', steps: [], fields: [{ name: 'key', label: 'Key', secret: true }] },
	async open(ctx) {
		return {
			async pair(input) {
				const key = Predicate.isObject(input) ? input['key'] : undefined;
				if (typeof key !== 'string') throw new Error('a key is required');
				await ctx.credentials.write(new Map([['credential', { key }]]));
				await ctx.status({ state: 'connected', account: key });
			},
			async close() {}
		};
	}
};

const settled = (answer: { readonly kind: string }) =>
	answer.kind === 'committed' ? Effect.void : Effect.die(new Error(answer.kind));
const sgd = {
	base_currency: 'SGD',
	recipients: [{ name: 'Owner', handle: '+65 9123 4567' }]
} as const;

it.layer(TestWorkspace.layer({ root, now: '2026-11-02T12:00:00.000Z' }))(
	'recipients with no account',
	(it) => {
		it.effect('refuse the run before it starts work', () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const owner = yield* t.as(t.member(['portfolio_manage']));
				yield* settled(yield* owner.act({ 'portfolio_settings.create': [sgd] }));
				yield* owner.run('portfolio_agent', {}, JobResult);
				const { failed } = yield* t.run_due();
				expect(failed).toMatchObject([{ error: expect.stringContaining('no active account') }]);
			})
		);
	}
);

it.layer(
	TestWorkspace.layer({
		root,
		now: '2026-11-02T12:00:00.000Z',
		providers: [whatsapp],
		fakes: { ai: { cassette: { default: [market, hold, watch] } } }
	})
)('the report in another currency, sent on WhatsApp', (it) => {
	it.effect(
		'values the book in SGD and queues the report to each recipient through the paired account',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const owner = yield* t.as(t.member(['portfolio_manage']));
				const admin = yield* t.as(t.admin);
				yield* settled(
					yield* admin.act({
						'sys_integration.create': [{ integration: 'whatsapp', name: 'Reports' }]
					})
				);
				const [account] = yield* t.db.rows(Schema.Struct({ id: id_of('sys_integration') }), {
					text: `SELECT id FROM sys_integration WHERE name = 'Reports'`,
					params: []
				});
				if (account === undefined) return yield* Effect.die(new Error('no account'));
				yield* t.integrations.pair(account.id, { key: 'k1' });
				yield* settled(
					yield* owner.act({ 'portfolio_settings.create': [{ ...sgd, report_via: account.id }] })
				);

				yield* owner.run('portfolio_agent', {}, JobResult);
				expect((yield* t.run_due()).failed).toEqual([]);
				expect(yield* owner.query({ report: { limit: 1 } })).toMatchObject({
					report: {
						rows: [
							{
								base_currency: 'SGD',
								headline: expect.stringContaining('Net assets SGD'),
								deliveries: [expect.any(String)]
							}
						]
					}
				});

				yield* t.syncs.deliver();
				expect(t.fakes.links.sent).toMatchObject([
					{
						instance: account.id,
						message: { to: '6591234567@s.whatsapp.net', text: expect.stringContaining('SGD') }
					}
				]);
				yield* t.event(account.id, {
					kind: 'delivery',
					provider_id: `${account.id}:1`,
					report: { kind: 'delivered', at: t.clock.now(), provider: 'fake' }
				});
				expect(
					yield* t.db.rows(Schema.Struct({ status: Schema.NullOr(Schema.String) }), {
						text: 'SELECT status FROM sys_message WHERE integration = $1',
						params: [account.id]
					})
				).toEqual([{ status: 'delivered' }]);
			})
	);
});
