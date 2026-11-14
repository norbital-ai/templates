import { Effect, Layer, Predicate, Schema } from 'effect';
import { JobResult, TestWorkspace, expect, it } from '@norbital-ai/bolt-cli/test';
import { id_of } from '@norbital-ai/bolt';
import { Render, WebRead, type Provider } from '@norbital-ai/bolt/engine';
import { ActRefused } from '@norbital-ai/bolt/errors';

const root = new URL('..', import.meta.url).pathname;

/** A stored decimal (a string) equal to `expected`. */
const decimal = (expected: number) => ({
	asymmetricMatch: (value: unknown) => typeof value === 'string' && Number(value) === expected,
	toString: () => `Decimal(${expected})`
});
const answer = (value: object) => ({
	content: JSON.stringify(value),
	tool_calls: [],
	finish: 'stop' as const,
	usage: { input: 0, output: 0 }
});
/** Acme's call cites its sources ([1] the quotes, [2] its story); the bond's cites nothing and is dropped. */
const hold = answer({
	headline: 'Acme wins a large order',
	happened: 'Acme won a large order, per [2].',
	matters: 'The line is the largest in the book, per [1].',
	call: 'hold',
	reason: 'The order backs the backlog, per [2].',
	confidence: 0.6
});
const watch = answer({
	headline: 'Bond yields ease',
	happened: 'Yields eased.',
	matters: 'Duration risk is the watch item.',
	call: 'watch',
	reason: 'Nothing changed.'
});
/** Lead sources: [1] quotes, [2] rates, [3] Acme's story. */
const lead = answer({
	lead: 'Acme won a large order, per [3].',
	market: 'Rates were steady, per [1].'
});

/** The page renderer: keeps the path of each record view it prints; its PDF bytes are a stand-in. */
const rendered: string[] = [];
const render = Layer.succeed(Render, {
	pdf: ({ path }) =>
		Effect.sync(() => {
			rendered.push(path);
			return new TextEncoder().encode('%PDF-1.7');
		})
});
/** The web: Acme's news feed carries one story and the bond fund's one; quotes and rates read empty. */
const ACME_NEWS = 'https://news.example/acme';
const ACME_LINK = `[news.example](${ACME_NEWS})`;
const feed = (title: string, url: string) =>
	`<rss><channel><item><title>${title}</title><link>${url}</link></item></channel></rss>`;
const web = Layer.succeed(WebRead, {
	read: (url) =>
		Effect.succeed({
			url,
			title: null,
			text: '',
			html: !url.startsWith('https://news.google.com/')
				? ''
				: url.includes('ACME')
					? feed('Acme wins a large order', ACME_NEWS)
					: feed('Bond yields ease', 'https://news.example/bonds')
		})
});
const ports = Layer.mergeAll(render, web);

it.layer(TestWorkspace.layer({ root, ports }))('the book', (it) => {
	it.effect('an owner adds a holding; a viewer reads the book but cannot', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const owner = yield* t.as(t.member(['portfolio_manage']));
			const viewer = yield* t.as(t.member(['portfolio_read']));
			const gold = {
				instrument: 'Gold bar',
				asset_class: 'metal',
				currency: 'USD',
				value_base: '900'
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

	it.effect(
		'a client subscribes and unsubscribes only themselves; an owner sees every subscriber',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const owner = yield* t.as(t.member(['portfolio_manage']));
				const holder = t.member(['portfolio_read']);
				const other = t.member(['portfolio_read']);
				const client = yield* t.as(holder);
				yield* t.as(other);
				const otherId = yield* Schema.decodeUnknownEffect(id_of('sys_user'))(other.id);

				yield* settled(yield* client.act({ 'report_subscription.create': [{}] }));
				const someoneElse = yield* Effect.flip(
					client.act({ 'report_subscription.create': [{ user: otherId }] })
				);
				expect(someoneElse).toMatchObject({ _tag: 'ActRefused', key: 'errors.own_subscription' });
				yield* settled(yield* owner.act({ 'report_subscription.create': [{ user: otherId }] }));

				expect(yield* client.query({ report_subscription: { limit: 10 } })).toMatchObject({
					report_subscription: { rows: [{ user: holder.id }] }
				});
				expect(yield* owner.query({ report_subscription: { limit: 10 } })).toMatchObject({
					report_subscription: { rows: [{}, {}] }
				});

				const [row] = yield* t.db.rows(
					Schema.Struct({ id: id_of('report_subscription'), revision: Schema.Int }),
					{
						text: `SELECT id, revision FROM report_subscription WHERE "user" = $1`,
						params: [holder.id]
					}
				);
				if (row === undefined) return yield* Effect.die(new Error('no subscription'));
				yield* settled(yield* client.act({ 'report_subscription.delete': [{ target: row }] }));
				expect(yield* client.query({ report_subscription: { limit: 10 } })).toMatchObject({
					report_subscription: { rows: [] }
				});
			})
	);

	it.effect('a loan is owed and a day has one report', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const owner = yield* t.as(t.member(['portfolio_manage']));
			const loan = yield* Effect.flip(
				owner.act({
					'holding.create': [
						{ instrument: 'Bridge loan', asset_class: 'loan', currency: 'USD', value_base: '500' }
					]
				})
			);
			expect(loan).toMatchObject({ _tag: 'ActRefused', key: 'errors.loan_is_owed' });

			const report = {
				for_date: '2026-11-01',
				base_currency: 'USD',
				headline: 'Draft',
				summary: 'Draft',
				net_assets: '1',
				invested: '1',
				cash: '0',
				liabilities: '0'
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
		now: '2026-11-01T23:00:00.000Z',
		ports,
		fakes: { ai: { cassette: { default: [hold, watch, lead, hold, watch, lead] } } }
	})
)('the daily agent', (it) => {
	it.effect(
		'files the report with every claim cited, drops an uncited call and files the day’s P&L',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const owner = yield* t.as(t.member(['portfolio_manage']));
				t.clock.set('2026-11-02T00:01:00.000Z');
				const { failed } = yield* t.run_due();
				expect(failed).toEqual([]);

				expect(yield* owner.query({ report: { limit: 10 } })).toMatchObject({
					report: {
						rows: [
							{
								for_date: '2026-11-02',
								net_assets: decimal(18100),
								liabilities: decimal(2000),
								headline: `Acme won a large order, per ${ACME_LINK}.`,
								summary: '- Markets: net assets USD 18,100.00\n- ACME UW: Acme wins a large order',
								markets: [
									{ instrument: 'Acme Robotics Inc', level: decimal(12000), change_pct: null },
									{ instrument: 'Global Bond Index Fund' },
									{ instrument: 'Operating account' },
									{ instrument: 'Credit facility' }
								],
								market_view: expect.stringContaining(
									'Rates were steady, per [Yahoo Finance](https://finance.yahoo.com).'
								),
								positions: [
									{
										instrument: 'Acme Robotics Inc',
										call: 'hold',
										headline: 'Acme wins a large order',
										analysis: [
											`**What happened:** Acme won a large order, per ${ACME_LINK}.`,
											'**Why it matters for the book:** The line is the largest in the book, per [Yahoo Finance](https://finance.yahoo.com).',
											`**Call:** HOLD. The order backs the backlog, per ${ACME_LINK}.`
										].join('\n\n')
									}
								],
								sources: expect.arrayContaining([
									expect.objectContaining({ publisher: 'news.example', url: ACME_NEWS })
								])
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
								research_summary: expect.stringContaining(`per ${ACME_LINK}`),
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
const GROUP = '120363000000000001@g.us';
const sgd = {
	base_currency: 'SGD',
	recipients: [
		{ name: 'Owner', handle: '+65 9123 4567' },
		{ name: 'Family', handle: GROUP }
	]
} as const;

it.layer(TestWorkspace.layer({ root, now: '2026-11-02T12:00:00.000Z', ports }))(
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
		ports,
		providers: [whatsapp],
		fakes: { ai: { cassette: { default: [hold, watch, lead] } } }
	})
)('the report in another currency, sent on WhatsApp', (it) => {
	it.effect(
		'values the book in SGD and sends its record view as a PDF to each chat and subscriber through the paired account',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const owner = yield* t.as(t.member(['portfolio_manage']));
				const admin = yield* t.as(t.admin);
				const client = yield* t.as(t.member(['portfolio_read'], { phone: '+65 9000 0001' }));
				yield* settled(yield* client.act({ 'report_subscription.create': [{}] }));
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
					yield* owner.act({
						'portfolio_settings.create': [{ ...sgd, report_via: account.id }]
					})
				);

				yield* owner.run('portfolio_agent', {}, JobResult);
				expect((yield* t.run_due()).failed).toEqual([]);
				expect(yield* owner.query({ report: { limit: 1 } })).toMatchObject({
					report: {
						rows: [
							{
								base_currency: 'SGD',
								summary: expect.stringContaining('net assets SGD'),
								deliveries: [expect.any(String), expect.any(String)]
							}
						]
					}
				});

				const [filed] = yield* t.db.rows(Schema.Struct({ id: Schema.String }), {
					text: `SELECT id FROM report`,
					params: []
				});
				if (filed === undefined) return yield* Effect.die(new Error('no report'));
				expect(rendered).toEqual([expect.stringContaining(`?record=report/${filed.id}&print`)]);

				yield* t.syncs.deliver();
				const pdf = [expect.objectContaining({ mime: 'application/pdf' })];
				expect(t.fakes.links.sent).toHaveLength(3);
				expect(t.fakes.links.sent).toEqual(
					expect.arrayContaining(
						['6591234567@s.whatsapp.net', GROUP, '6590000001@s.whatsapp.net'].map((to) =>
							expect.objectContaining({
								instance: account.id,
								message: expect.objectContaining({
									to,
									text: expect.stringContaining('Acme won a large order, per news.example.'),
									attachments: pdf
								})
							})
						)
					)
				);
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
				).toContainEqual({ status: 'delivered' });
			})
	);
});
