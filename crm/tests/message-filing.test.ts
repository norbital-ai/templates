import { expect, layer } from '@effect/vitest';
import { TestWorkspace, JobResult } from '@norbital-ai/bolt-cli/test';
import { ActConflict, ActRefused } from '@norbital-ai/bolt/errors';
import { Effect } from 'effect';
import { skipRacedWrite } from '../src/lib/message-import.js';
import { member, nativeId, recordOf, required, targetOf, pageOf } from './workspace.js';

const fixture = (n: number) => `0b000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// `seed/test`: one customer with a closed and an open job and its PIC Casey; one with two jobs and its PIC Dana
const single = nativeId('companies', fixture(1));
const double = nativeId('companies', fixture(2));
const portal = nativeId('projects', fixture(12));
const website = nativeId('projects', fixture(13));
const payroll = nativeId('projects', fixture(14));
const casey = nativeId('contacts', fixture(21));

layer(TestWorkspace.layer({ root: `${process.cwd()}/` }), { excludeTestServices: true })(
	'message filing',
	(it) => {
		it.effect(
			'files a PIC message to the job it names or the customer’s only open job; a member’s filing outlives the classifier',
			() =>
				Effect.gen(function* () {
					const t = yield* TestWorkspace;
					const admin = yield* t.as(t.admin);
					const sales = yield* member(t, ['sales', 'crm']);
					const message = (seq: number, subject: string, handle: string, detail: string) => ({
						kind: 'message' as const,
						classification: 'pending' as const,
						subject,
						handle,
						detail,
						source_seq: seq
					});
					const created = yield* admin.act({
						'activities.create': [
							message(1, 'Casey', '6591000001@s.whatsapp.net', 'Can we talk tomorrow?'),
							message(2, 'Re: website rebuild timeline', 'Dana <dana@two.test>', 'Dates attached.'),
							message(3, 'Quick question', 'dana@two.test', 'Are you free?'),
							message(4, 'Another question', 'dana@two.test', 'Still free?')
						]
					});
					if (created.kind !== 'committed') throw new Error(JSON.stringify(created));
					const [only, named, unclear, filed] = [0, 1, 2, 3].map(
						(index) => recordOf(created.records, 'activities', index).id
					);
					expect(
						(yield* (yield* t.as(sales)).act({
							'activities.update': [
								{
									target: yield* targetOf(t, 'activities', required(filed)),
									set: { project_id: payroll }
								}
							]
						})).kind
					).toBe('committed');
					yield* admin.run('classify_messages', {}, JobResult);
					yield* t.run_due();
					const row = (id: typeof only) =>
						admin
							.query({ activities: { where: { id: { eq: required(id) } }, limit: 1 } })
							.pipe(Effect.map((answer) => pageOf(answer, 'activities').rows[0] ?? null));
					expect(yield* row(only)).toMatchObject({
						classification: 'useful',
						company: single,
						contact_id: casey,
						project_id: portal
					});
					expect(yield* row(named)).toMatchObject({
						classification: 'useful',
						company: double,
						project_id: website
					});
					expect(yield* row(unclear)).toMatchObject({
						classification: 'pending',
						company: double,
						project_id: null
					});
					expect(yield* row(filed)).toMatchObject({
						classification: 'useful',
						classified_by: 'manual',
						company: double,
						project_id: payroll
					});
				})
		);

		it.effect('skips only a raced per-message write', () =>
			Effect.gen(function* () {
				expect(yield* skipRacedWrite(Effect.succeed('committed'))).toBe('committed');
				expect(yield* skipRacedWrite(Effect.fail(new ActConflict({ records: [] })))).toBeNull();
				expect(
					yield* skipRacedWrite(
						Effect.fail(
							new ActRefused({
								code: 'refused',
								message: 'Outside selection.',
								field: 'source_message'
							})
						)
					)
				).toBeNull();
				expect(
					yield* Effect.flip(
						skipRacedWrite(
							Effect.fail(
								new ActRefused({ code: 'refused', message: 'Set a due date.', field: 'due_on' })
							)
						)
					)
				).toMatchObject({ _tag: 'ActRefused', field: 'due_on' });
			})
		);
	}
);
