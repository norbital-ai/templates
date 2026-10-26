import { Effect, Exit, Scope } from 'effect';
import { visit, type ShellMountConfig } from '@norbital-ai/bolt/test/browser';
import type { T } from '../kit.js';
import english from '../../src/i18n/+messages.js';
import chinese from '../../src/i18n/+zh.messages.js';
export const open = Effect.fnUntraced(function* (
	t: T,
	actor: T['admin'],
	path: string,
	locale: string,
	pages: ShellMountConfig['pages'],
	representations?: ShellMountConfig['representations'],
	beforeRequest?: (request: Request) => void
) {
	if (actor.actor.kind !== 'member')
		return yield* Effect.die(new Error('UI journey requires a member'));
	// The real browser issues writes at its wall clock; the native host validates their age.
	t.clock.set(new Date().toISOString());
	localStorage.setItem('bolt.locale', locale);
	// the journey's modules load first, so its waits time the render, not a first compile under a parallel run
	yield* Effect.promise(() =>
		Promise.all(
			[...Object.values(pages ?? {}), ...Object.values(representations ?? {})].map((load) => load())
		)
	);
	const scope = yield* Scope.make();
	yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
	const traffic: string[] = [];
	const ui = yield* visit(
		path,
		{ ...actor, id: actor.actor.id },
		{
			pages,
			...(representations === undefined ? {} : { representations }),
			messages: locale === 'zh' ? chinese : english,
			onRequest: (request) => {
				traffic.push(`${request.method} ${new URL(request.url).pathname}`);
				// Request body reading is this native browser tracing edge; journey assertions inspect its wire text.
				void request
					.clone()
					.text()
					.then((body) => {
						if (body !== '') traffic.push(body);
					})
					.catch((failure: unknown) => {
						traffic.push(`Request tracing failed: ${String(failure)}`);
					});
				beforeRequest?.(request);
			}
		}
	).pipe(Effect.provide(t.services), Effect.provideService(Scope.Scope, scope));
	return {
		target: ui.target,
		traffic,
		close: () =>
			Scope.close(scope, Exit.void).pipe(
				Effect.tap(() => Effect.sync(() => localStorage.removeItem('bolt.locale')))
			)
	};
});
