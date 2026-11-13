/**
 * Dispatch mechanisms through the real engine on the `seed/test` roster: the ETA flag, the shift-check replacement and quote
 * binding (availability, booking and preference matching are matching.test's). One workspace booted at Tuesday 08:00 in
 * Singapore; no `runDue` follows a clock step, so no cron fires.
 */
import { expect, layer } from '@effect/vitest';
import type { ActInput, Id } from '@norbital-ai/bolt';
import { JobResult, TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
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
const WEDNESDAY_10 = '2026-09-30T02:00:00.000Z';
const phone = '+6580000001';
const address = '1 Example Avenue, Singapore 400001';
const Runs = Schema.Struct({
	automation: Schema.String,
	cause: Schema.String,
	state: Schema.String
});
const desk = (t: Kit) => t.as(t.member(['operations']));
function committed(outcome: { readonly kind: string }) {
	if (outcome.kind !== 'committed') throw new Error(JSON.stringify(outcome));
}
/** The visit fields the assertions read, decoded from the native answer. */
const VisitPage = Schema.Struct({
	visits: Schema.Struct({
		rows: Schema.Array(
			Schema.Struct({
				attention: Schema.String,
				eta_minutes: Schema.NullOr(Schema.Number),
				shift_check: Schema.String,
				helper: Schema.NullOr(Schema.String),
				proposed_helper: Schema.NullOr(Schema.String)
			})
		)
	})
});
const visitRow = Effect.fnUntraced(function* (t: Kit, target: Id<'visits'>) {
	const admin = yield* t.as(t.admin);
	const page = yield* Schema.decodeUnknownEffect(VisitPage)(
		yield* admin.query({ visits: { where: { id: { eq: target } }, limit: 1 } })
	);
	return present(page.visits.rows[0]);
});
const Rows = Schema.Struct({ rows: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)) });

layer(
	TestWorkspace.layer({
		root: `${process.cwd()}/`,
		now: '2026-09-29T00:00:00.000Z'
	}),
	{ excludeTestServices: true }
)('dispatch', (it) => {
	it.effect('the ETA check flags a helper whose drive exceeds the limit', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			yield* finished(t, admin.run('eta_check', { visit: DRIVEN }, JobResult));
			const late = yield* visitRow(t, DRIVEN);
			expect(late.attention).toBe('eta_risk');
			expect(late.eta_minutes).toBeGreaterThan(30);
		})
	);

	it.effect('shift-check silence proposes a replacement the desk assigns', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			// the seed asked Alpha at 07:45; the reply window has passed
			const admin = yield* t.as(t.admin);
			yield* finished(t, admin.run('shift_watch', {}, JobResult));
			expect(yield* visitRow(t, CHECKED)).toMatchObject({
				shift_check: 'no_response',
				helper: null,
				proposed_helper: CHARLIE,
				attention: 'awaiting_approval'
			});
			yield* finished(
				t,
				(yield* desk(t)).run('visits_accept_proposal', { targets: [CHECKED] }, JobResult)
			);
			expect(yield* visitRow(t, CHECKED)).toMatchObject({
				helper: CHARLIE,
				proposed_helper: null,
				attention: 'none'
			});
			const warnings = yield* Schema.decodeUnknownEffect(Schema.Struct({ helper_warnings: Rows }))(
				yield* admin.query({ helper_warnings: { where: { helper: { eq: ALPHA } } } })
			);
			expect(warnings.helper_warnings.rows).toMatchObject([{ reason: 'no_response' }]);
		})
	);

	it.effect('a helper answers the shift check only for their own visits', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			const helper = (row: Id<'helpers'>) =>
				Effect.gen(function* () {
					const member = t.member(['helper']);
					const user = fixtureId('sys_user', member.id);
					const { helpers } = yield* Schema.decodeUnknownEffect(
						Schema.Struct({
							helpers: Schema.Struct({
								rows: Schema.Array(Schema.Struct({ revision: Schema.Int }))
							})
						})
					)(yield* admin.query({ helpers: { where: { id: { eq: row } }, fields: ['revision'] } }));
					const revision = present(helpers.rows[0]).revision;
					committed(
						yield* admin.act({
							'helpers.update': [{ target: { id: row, revision }, set: { user } }]
						})
					);
					return yield* t.as(member);
				});
			// the run holds `helper`, scoped to its starter: Alpha cannot confirm Charlie's day (which now holds
			// Alpha's reassigned visit)
			const alpha = yield* helper(ALPHA);
			expect(
				yield* Effect.flip(
					finished(t, alpha.run('visits_confirm_shift', { targets: [DRIVEN] }, JobResult))
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(yield* visitRow(t, CHECKED)).toMatchObject({
				helper: CHARLIE,
				shift_check: 'not_due'
			});
			const charlie = yield* helper(CHARLIE);
			yield* finished(t, charlie.run('visits_confirm_shift', { targets: [DRIVEN] }, JobResult));
			expect(yield* visitRow(t, CHECKED)).toMatchObject({ shift_check: 'confirmed' });
		})
	);

	it.effect('a quote binds to its exact inputs, and expires', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = yield* t.as(t.admin);
			const customer = yield* t.as(t.member(['customer'], { external: true, phone }));
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
					customer.act({ 'booking_requests.create': [request({ address: 'Another address' })] })
				)
			).toMatchObject({ _tag: 'ActRefused' });
			committed(yield* customer.act({ 'booking_requests.create': [request()] }));
			// the request's effect, as the customer, schedules `portal_intake`, which books it as dispatch
			yield* t.run_due();
			expect(
				yield* t.db.rows(Runs, {
					text: `SELECT automation, cause, state FROM sys_run WHERE automation IN ('booking_requests.effect.create', 'portal_intake') ORDER BY automation`,
					params: []
				})
			).toEqual([
				{ automation: 'booking_requests.effect.create', cause: 'effect', state: 'succeeded' },
				{ automation: 'portal_intake', cause: expect.any(String), state: 'succeeded' }
			]);
			// no run the effects so far scheduled (the desk's, the dispatch runs', the customer's) failed
			expect(
				yield* t.db.rows(Runs, {
					text: `SELECT automation, cause, state FROM sys_run WHERE state = 'failed'`,
					params: []
				})
			).toEqual([]);
			const requests = yield* Schema.decodeUnknownEffect(Schema.Struct({ booking_requests: Rows }))(
				yield* admin.query({ booking_requests: { where: { phone: { eq: phone } } } })
			);
			expect(requests.booking_requests.rows).toMatchObject([{ status: 'booked' }]);
			t.clock.advance('16min');
			expect(
				yield* Effect.flip(customer.act({ 'booking_requests.create': [request()] }))
			).toMatchObject({
				_tag: 'ActRefused',
				key: 'errors.availability_changed'
			});
		})
	);
});
