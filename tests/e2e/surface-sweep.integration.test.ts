// @vitest-environment happy-dom
import { Effect } from 'effect';
import { sourceOrder, sourceTransaction } from '../synced-kit.js';
import type { Component } from 'svelte';
import { expect, it as test } from '@effect/vitest';
import { sweep } from '@norbital-ai/bolt/test/browser';
import teams from '../../src/access_control/team/+team.js';
import english from '../../src/i18n/+messages.js';
import chinese from '../../src/i18n/+zh.messages.js';
import { confirm, draft, workspace } from '../kit.js';
const pages = Object.fromEntries(
	Object.entries(
		import.meta.glob<{
			default: Component;
		}>('../../src/app/**/+*.page.svelte')
	).map(([path, load]) => [
		path.replace('../../src/app/', '').replace(/\/\+([a-z0-9_]+)\.page\.svelte$/, '/$1'),
		load
	])
);
type RepresentationLoader = NonNullable<
	NonNullable<Parameters<typeof sweep>[0]>['representations']
>[string];
const representations = Object.fromEntries(
	Object.entries(
		import.meta.glob<Awaited<ReturnType<RepresentationLoader>>>(
			'../../src/data/collection/**/+representation.svelte'
		)
	).map(([path, load]) => [
		path.replace('../../src/data/collection/', '').replace('/+representation.svelte', ''),
		load
	])
);
test.live.each(['en', 'zh'])(
	'all exposed pages and populated representations render for each team in %s',
	(locale) =>
		Effect.gen(function* () {
			localStorage.setItem('bolt.locale', locale);
			const t = yield* workspace({ now: '2026-10-10T00:00:00Z' });
			const { order, line } = yield* draft(t);
			yield* confirm(t, order);
			const parent = yield* sourceOrder(t, order);
			yield* sourceTransaction(t, { order, line }, parent);
			const report = yield* sweep({
				pages,
				messages: locale === 'zh' ? chinese : english,
				representations,
				as: [{ admin: true }, ...Object.values(teams).map((policies) => ({ policies }))]
			}).pipe(Effect.provide(t.services));
			expect(report.visited.map((v) => v.path)).toEqual(
				expect.arrayContaining([
					'/app/operations/trade/orders',
					'/app/operations/warehouse/stock',
					'/app/trade_configuration/rules'
				])
			);
			for (const collection of Object.keys(representations))
				expect(report.visited.some((v) => v.path.endsWith(`?record=${collection}/new`))).toBe(true);
			expect(report.findings).toEqual([]);
			localStorage.removeItem('bolt.locale');
		})
);
