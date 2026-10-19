import type { Committed, PendingApproval, ActInput } from '@norbital-ai/bolt';
import { Writes, type ActRequest, type Authority, type Json } from '@norbital-ai/bolt/engine';
import { type TestOptions, type TestPorts } from '@norbital-ai/bolt/test';
import { workspace as acquireWorkspace, fixtureId } from './test-runtime.js';
import { Context, Effect } from 'effect';
import { PlainDate } from '@norbital-ai/std/date';
/** The template root: `bolt test` runs from it. */
const root = `${process.cwd()}/`;
export const CONTROLLER = ['field_ops_controller'];
export const CONTRACTOR = ['field_ops_contractor'];
type Options<P extends TestPorts> = Omit<Extract<TestOptions<P>, { artifact?: never }>, 'root'> & {
	sample?: true;
};
export const workspace = <P extends TestPorts = never>(options: Options<P> = {}) => {
	const { sample, ...rest } = options;
	return acquireWorkspace({ root, seed: sample ? 'sample' : 'none', ...rest });
};
/** The ids an act committed, or the outcome as the failure. */
export function committed<O, N extends string>(outcome: Committed<O, N> | PendingApproval<N>) {
	if (outcome.kind !== 'committed') throw new Error(JSON.stringify(outcome));
	return outcome.records.map((record) => record.id);
}
export type T = Effect.Success<ReturnType<typeof workspace>>;
/** Deliberately invalid inputs exercise the native wire refusal without claiming a typed callable input. */
export const wireAct = Effect.fnUntraced(function* (
	t: T,
	authority: Authority,
	request: Pick<ActRequest, 'collection' | 'verb' | 'input'>
) {
	const now = t.clock.now();
	return (yield* Context.get(t.services, Writes).act({
		...request,
		mode: { _tag: 'Direct' },
		authority,
		key: crypto.randomUUID(),
		invocationId: crypto.randomUUID(),
		issuedAt: now,
		bindings: { now, today: now.slice(0, 10), tz: 'Asia/Singapore', params: {} }
	})).outcome;
});
let postal = 500000;
/** A site (at a fresh postal code) and an unassigned job on it, as a controller files them. */
export const siteWithJob = Effect.fnUntraced(function* (
	t: T,
	over: Partial<Exclude<ActInput<'job_assignments.create'>, readonly unknown[]>> = {}
) {
	const as = t.as(t.member(CONTROLLER));
	const [createdSite] = committed(
		yield* as.act('sites.create', { name: `58 Kismis Avenue, Singapore ${++postal}` })
	);
	const site = fixtureId('sites', createdSite);
	const [createdJob] = committed(
		yield* as.act('job_assignments.create', {
			site_id: site,
			title: 'Installation — Kismis',
			scheduled_for: PlainDate('2026-09-25'),
			description: 'Grab bars',
			...over
		})
	);
	return { site, job: fixtureId('job_assignments', createdJob) };
});
export const rows = Effect.fnUntraced(function* (t: T, text: string, params: Json[] = []) {
	const [result] = yield* t.db.read([{ text, params }]);
	if (result === undefined) throw new Error('Missing SQL result');
	return result.rows;
});
/** A real member (a `sys_user` row) holding `policies`, with a WhatsApp number when given. */
export const person = Effect.fnUntraced(function* (
	t: T,
	policies: readonly string[],
	phone: string | null = null
) {
	const id = crypto.randomUUID();
	yield* t.db.write({
		text: `INSERT INTO sys_user (id, email, name, kind, admin, phone) VALUES ($1, $2, $3, 'staff', false, $4)`,
		params: [id, `${id}@field.test`, `Person ${id.slice(0, 4)}`, phone]
	});
	return t.member(policies, { id });
});
