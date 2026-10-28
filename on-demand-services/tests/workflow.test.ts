/**
 * Dispatch mechanisms through the real engine on the `seed/test` roster: the ETA flag, the shift-check replacement and quote
 * binding (availability, booking and preference matching are matching.test's). One workspace booted at Tuesday 08:00 in
 * Singapore; no `runDue` follows a clock step, so no cron fires.
 */
import { expect, layer } from '@effect/vitest';
import type { ActInput, Committed, Id, PendingApproval } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt/test';
import { Instant } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { finished } from './automation-runtime.js';
import { fixtureId, present } from './test-runtime.js';

const id = <C extends string>(model: C, n: number) =>
	fixtureId(model, `0d5000ff-0000-4000-8000-${String(n).padStart(12, '0')}`);
const HOME_CLEANING = id('services', 1);
const ALPHA = id('helpers', 2);
const CHARLIE = id('helpers', 3);
/** Alpha's 10:00 visit, the day's first: asked at 07:45, never answered. */
const CHECKED = id('visits', 5);
/** Charlie's 08:45 visit, confirmed: its ETA is checked. */
const DRIVEN = id('visits', 6);
/** The customer's ready quote, timed at boot: Wednesday 10:00. */
const QUOTE = id('availability_requests', 8);
const WEDNESDAY_10 = Instant('2026-09-30T02:00:00.000Z');
const phone = '+6580000001';
const address = '1 Example Avenue, Singapore 400001';
const desk = (t: Kit) => t.as(t.member(['operations']));
function committed<O, N extends string>(outcome: Committed<O, N> | PendingApproval<N>) {
	if (outcome.kind !== 'committed') throw new Error(JSON.stringify(outcome));
	return outcome;
}
const visitRow = Effect.fnUntraced(function* (t: Kit, target: Id<'visits'>) {
	return present(
		(yield* t.as(t.admin).query({ visits: { where: { id: { eq: target } }, limit: 1 } })).visits
			.rows[0]
	);
});

layer(
	TestWorkspace.layer({ root: `${process.cwd()}/`, now: '2026-09-29T00:00:00.000Z' }),
	{ excludeTestServices: true }
)('dispatch', (it) => {
	it.effect('the ETA check flags a helper whose drive exceeds the limit', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* finished(t, t.as(t.admin).start('eta_check', { visit: DRIVEN }));
			const late = yield* visitRow(t, DRIVEN);
			expect(late.attention).toBe('eta_risk');
			expect(late.eta_minutes).toBeGreaterThan(30);
		})
	);

	it.effect('shift-check silence proposes a replacement the desk assigns', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			// the seed asked Alpha at 07:45; the reply window has passed
			yield* finished(t, t.as(t.admin).start('shift_watch', {}));
			expect(yield* visitRow(t, CHECKED)).toMatchObject({
				shift_check: 'no_response',
				helper: null,
				proposed_helper: CHARLIE,
				attention: 'awaiting_approval'
			});
			yield* finished(t, desk(t).start('visits_accept_proposal', { targets: [CHECKED] }));
			expect(yield* visitRow(t, CHECKED)).toMatchObject({
				helper: CHARLIE,
				proposed_helper: null,
				attention: 'none'
			});
			expect(
				(yield* t.as(t.admin).query({ helper_warnings: { where: { helper: { eq: ALPHA } } } }))
					.helper_warnings.rows
			).toMatchObject([{ reason: 'no_response' }]);
		})
	);

	it.effect('a quote binds to its exact inputs, and expires', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const customer = t.as(t.member(['customer'], { external: true, phone }));
			const request = (
				over: Partial<ActInput<'booking_requests.create'>[number]> = {}
			): ActInput<'booking_requests.create'>[number] => ({
				name: 'Fixture Customer One',
				phone,
				address,
				area: 'east',
				service: HOME_CLEANING,
				repeat: 'once',
				start: WEDNESDAY_10,
				availability: QUOTE,
				...over
			});
			expect(
				yield* Effect.flip(
					customer.act('booking_requests.create', [request({ address: 'Another address' })])
				)
			).toMatchObject({ _tag: 'ActRefused' });
			committed(yield* customer.act('booking_requests.create', [request()]));
			t.clock.advance('16min');
			expect(
				yield* Effect.flip(customer.act('booking_requests.create', [request()]))
			).toMatchObject({
				_tag: 'ActRefused',
				message: expect.stringContaining('Check times again')
			});
		})
	);
});
