import { Effect } from 'effect';
import { JobResult, TestWorkspace, expect, it } from '@norbital-ai/bolt-cli/test';
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
