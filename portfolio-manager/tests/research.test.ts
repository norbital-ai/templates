import { Effect, Option } from 'effect';
import { expect, it } from '@effect/vitest';
import { Unavailable } from '@norbital-ai/bolt/errors';
import { readPage, search, type Reader } from '../src/lib/portfolio/market.ts';

const page = (url: string, text: string) => ({ url, title: null, text });
/** A browser over fixed pages: a search page answers its result links, every other page its text. */
const browser = (pages: Record<string, string>): Reader['browser'] => ({
	navigate: (url) =>
		pages[url] === undefined
			? Effect.fail(new Unavailable({ facility: 'browser', reason: 'not in the fixture' }))
			: Effect.succeed(page(url, pages[url])),
	evaluate: () =>
		Effect.succeed([
			{ title: 'Acme wins a contract', url: 'https://news.example/acme' },
			{ title: '', url: 'https://news.example/empty' }
		])
});
const web: Reader['web'] = {
	read: (url) => Effect.succeed(page(url, `plain   read of ${url}`))
};

it.effect('searches in the browser and reads each result', () =>
	Effect.gen(function* () {
		const log: string[] = [];
		const reader = {
			browser: browser({
				'https://www.bing.com/search?q=ACME%20stock%20news': 'results',
				'https://news.example/acme': 'Acme   won a large order.'
			}),
			web
		};
		expect(yield* search(reader, 'ACME stock news', 2, log)).toEqual([
			{
				label: 'Acme wins a contract',
				url: 'https://news.example/acme',
				text: 'Acme won a large order.'
			}
		]);
		expect(log[0]).toBe('search bing "ACME stock news": 1 result(s)');
	})
);

it.effect('without a browser it finds nothing and a page falls back to a plain read', () =>
	Effect.gen(function* () {
		const log: string[] = [];
		const reader = { browser: browser({}), web };
		expect(yield* search(reader, 'stock market today', 3, log)).toEqual([]);
		expect(log).toEqual(['search "stock market today": no browser']);
		expect(yield* readPage(reader, 'https://ir.example')).toEqual(
			Option.some('plain read of https://ir.example')
		);
	})
);
