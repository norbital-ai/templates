// A law change merged by mistake. A merged change is a sealed version, and a run answers to the version in force on its
// pay date. The research pipeline is real, with a scripted model; the change it carries is one contribution rate of the
// fixture pack, and every expected figure is one the test chose or the system itself produced.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { JobResult, TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { plain_date } from '../../src/lib/date.ts';
import { Effect } from 'effect';
import { objectValue } from '../../src/lib/payroll_engine/reads.ts';
import { amendments, carriedFor, ownLines, pay, run } from '../amendment_kit.ts';
import { catalogRow, current, pack, refusal, storedQuery, workspace } from '../kit.ts';

const CODE = 'MY';
const NOW = '2027-02-05T02:00:00.000Z';
const ROW = 'EPF';
const WAGE = 10_000;
const SEED = pack(
	CODE,
	'Asia/Kuala_Lumpur',
	{
		rate: { amount: WAGE, unit: 'MONTHLY' },
		statutory_work_category: 'NON_MANUAL',
		work_classification: 'EA_COVERED',
		residency_status: 'CITIZEN',
		wage_payment_method: 'BANK',
		allowances: {}
	},
	{},
	[],
	[],
	'2027-02-05'
);
/** The rate the version in force holds, and the one the mistaken release merges instead. */
const LAWFUL = objectValue(
	SEED.statutory_contribution_catalog?.find(
		(row) => row.id === catalogRow(SEED, 'statutory_contribution_catalog', ROW)
	)?.lookup
).employee_rate;
const MISTAKEN = 0.125;
/** The company with nobody on its payroll: a run it makes holds no one, so a law merge never waits on it. */
const NOBODY = {
	...SEED,
	sys_user: [],
	employee_profile: [],
	employee_balance: [],
	employee_contract: []
};
const answer = (value: unknown) => ({
	content: JSON.stringify(value),
	tool_calls: [],
	finish: 'stop' as const,
	usage: { input: 0, output: 0 }
});
/** One research pass: an instrument found, then its one change to the row's employee rate. */
const found = (instrument: string, rate: unknown, from: string) => [
	answer({
		findings: [
			{
				instrument,
				title: 'Employee contribution rate',
				fit: 'VALUE',
				families: ['statutory_contribution_catalog'],
				source_urls: ['https://law.example.gov/instrument.pdf'],
				source_quote: 'The employee contribution rate.'
			}
		],
		new_sources: []
	}),
	answer({
		changes: [
			{ row_code: ROW, field_path: 'lookup.employee_rate', new_value: rate, effective_from: from }
		]
	})
];
const scenario = (
	turns: readonly ReturnType<typeof answer>[],
	body: (t: Kit) => Effect.Effect<void, unknown>,
	seed: typeof SEED = SEED
) =>
	Effect.gen(function* () {
		yield* body(yield* TestWorkspace);
	}).pipe(
		Effect.provide(
			workspace({
				seed,
				now: NOW,
				fakes: { ai: { cassette: { strong: [...turns] } } },
				host: {
					agent: {
						host_tools: [
							{
								name: 'web_search',
								description: 'The host search the cassette never calls.',
								input: { type: 'object' },
								behavior: {},
								call: async () => []
							}
						]
					}
				}
			})
		)
	);
/** Confirm the one finding still proposed and merge the release of `on`. */
const released = (t: Kit, on: string) =>
	Effect.gen(function* () {
		const { statutory_finding } = yield* storedQuery(t, { statutory_finding: { limit: 100 } });
		const proposed = statutory_finding.rows.find((row) => row.status === 'PROPOSED');
		assert.ok(proposed !== undefined, 'Nothing is proposed');
		yield* (yield* t.as(t.admin)).act({
			'statutory_finding.update': [{ target: proposed, set: { status: 'CONFIRMED' } }]
		});
		yield* (yield* t.as(t.admin)).run(
			'statutory_materialize',
			{ code: CODE, target: plain_date(on), merge: true },
			JobResult
		);
		yield* t.run_due();
	});
/** Research once, confirm what it proposed and merge the release of `on`. */
const merged = (t: Kit, on: string) =>
	t.as(t.admin).pipe(
		Effect.andThen((admin) => admin.run('statutory_research', { code: CODE }, JobResult)),
		Effect.andThen(t.run_due()),
		Effect.andThen(released(t, on))
	);
const sealedLaw = (t: Kit) =>
	storedQuery(t, {
		jurisdiction_settings: { where: { code: { eq: CODE }, status: { eq: 'SEALED' } }, limit: 100 }
	}).pipe(
		Effect.map(({ jurisdiction_settings }) =>
			jurisdiction_settings.rows.toSorted((left, right) =>
				String(left.effective_range.from).localeCompare(String(right.effective_range.from))
			)
		)
	);
/** The sealed version starting on a day. */
const lawFrom = (t: Kit, from: string) =>
	sealedLaw(t).pipe(
		Effect.map((rows) => {
			const version = rows.find((row) => String(row.effective_range.from) === from);
			assert.ok(version !== undefined, `No sealed law from ${from}`);
			return version;
		})
	);
const rateIn = (t: Kit, version: Id<'jurisdiction_settings'>) =>
	storedQuery(t, {
		statutory_contribution_catalog: {
			where: { settings_id: { eq: version }, code: { eq: ROW } },
			limit: 1
		}
	}).pipe(
		Effect.map(
			({ statutory_contribution_catalog }) =>
				objectValue(statutory_contribution_catalog.rows[0]?.lookup).employee_rate
		)
	);
/** The run of a period deleted. */
const dropped = (t: Kit, ran: { readonly id: Id<'payroll_run'> }) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'payroll_run.delete': [{ target: yield* current(t, 'payroll_run', ran.id) }]
		});
		yield* t.run_due();
	});

describe('a law change merged by mistake', () => {
	it.live(
		'superseded: a corrective release from the next day ends it, and a run made under it is deleted and run again on the corrected law',
		() =>
			scenario(
				[
					...found('Instrument 1', MISTAKEN, '2027-02-01'),
					...found('Instrument 2', LAWFUL, '2027-02-02')
				],
				(t) =>
					Effect.gen(function* () {
						const stood = (yield* sealedLaw(t)).at(-1);
						assert.ok(stood !== undefined);
						assert.equal(yield* rateIn(t, stood.id), LAWFUL);
						assert.notEqual(MISTAKEN, LAWFUL);
						yield* merged(t, '2027-02-01');
						const mistaken = yield* lawFrom(t, '2027-02-01');
						assert.equal(yield* rateIn(t, mistaken.id), MISTAKEN);
						// what it moves: every run whose pay date it covers
						const made = yield* run(t, '2027-02');
						assert.equal(made.settings_id, mistaken.id);

						// the correction is a new release: the mistaken version stays sealed, for the one day it stood
						yield* merged(t, '2027-02-02');
						const corrected = yield* lawFrom(t, '2027-02-02');
						assert.equal(yield* rateIn(t, corrected.id), LAWFUL);
						assert.equal(
							String((yield* lawFrom(t, '2027-02-01')).effective_range.to),
							'2027-02-01'
						);
						// the run made under the mistake keeps its law until it is deleted and run again
						const { payroll_run } = yield* storedQuery(t, {
							payroll_run: { where: { id: { eq: made.id } }, limit: 1 }
						});
						assert.equal(payroll_run.rows[0]?.settings_id, mistaken.id);
						yield* dropped(t, made);
						assert.equal((yield* run(t, '2027-02')).settings_id, corrected.id);
					}),
				NOBODY
			)
	);

	it.live(
		'superseded after its run was paid: everyone paid under it is amended, and the next run carries the difference',
		() =>
			scenario(
				[
					...found('Instrument 1', MISTAKEN, '2027-02-01'),
					...found('Instrument 2', LAWFUL, '2027-02-02')
				],
				(t) =>
					Effect.gen(function* () {
						yield* merged(t, '2027-02-01');
						yield* pay(t, '2027-02');
						const paid = yield* ownLines(t, '2027-02');
						assert.deepEqual(yield* amendments(t), []);
						// the corrective release covers the paid run's pay date: its people are amended by the merge itself
						yield* merged(t, '2027-02-02');
						assert.deepEqual(
							(yield* amendments(t)).map((row) => [row.period, row.payroll_run_id]),
							[['2027-02', null]]
						);
						yield* Effect.sync(() => t.clock.set('2027-03-05T02:00:00.000Z'));
						yield* run(t, '2027-03');
						// March pays the same wage on the corrected law: what February should have charged, less what it did
						const march = yield* ownLines(t, '2027-03');
						const own = march[`${ROW}/EMPLOYEE`] ?? 0;
						const charged = paid[`${ROW}/EMPLOYEE`] ?? 0;
						assert.ok(charged < own, 'the mistaken rate charged more');
						assert.equal(
							(yield* carriedFor(t, '2027-03', '2027-02'))[`${ROW}/EMPLOYEE`],
							Number((own - charged).toFixed(2))
						);
						assert.deepEqual(yield* ownLines(t, '2027-02'), paid, 'the paid payslip stands');
					})
			)
	);

	it.live(
		'voided: no run can be made until the release is merged again as it should have been, from the version that stood before',
		() =>
			scenario(found('Instrument 1', MISTAKEN, '2027-02-01'), (t) =>
				Effect.gen(function* () {
					const stood = (yield* sealedLaw(t)).at(-1);
					assert.ok(stood !== undefined);
					yield* merged(t, '2027-02-01');
					const mistaken = yield* lawFrom(t, '2027-02-01');
					yield* (yield* t.as(t.admin)).act({
						'jurisdiction_settings.update': [
							{ target: mistaken, set: { status: 'VOID', reason: 'Merged with the wrong rate' } }
						]
					});
					yield* t.run_due();
					// the version before it was ended to make room, and a sealed version only ever shortens
					const ended = yield* lawFrom(t, String(stood.effective_range.from));
					const lawless = yield* refusal(run(t, '2027-02'));
					assert.equal(lawless.key, 'errors.payroll_run_no_law');
					assert.equal(lawless.values?.code, CODE);
					assert.match(String(lawless.values?.date), /^2027-02-\d\d$/);
					assert.equal(
						(yield* refusal(
							t.as(t.admin).pipe(
								Effect.andThen((caller) =>
									caller.act({
										'jurisdiction_settings.update': [
											{
												target: ended,
												set: {
													effective_range: {
														from: ended.effective_range.from,
														to: '2027-02-28'
													}
												}
											}
										]
									})
								)
							)
						)).key,
						'errors.jurisdiction_sealed_shorten_only'
					);
					// the way out: the release as it should have been, on the same date. Research reads only law still in
					// force today and the last version has ended, so HR files the finding and its change by hand, against the
					// version that stood before; the materializer takes that version as its baseline.
					yield* (yield* t.as(t.admin)).act({
						'statutory_finding.create': [
							{
								jurisdiction_code: CODE,
								instrument_key: 'instrument-2',
								title: 'Employee contribution rate, as the instrument states it',
								fit: 'VALUE',
								status: 'PROPOSED',
								families: ['statutory_contribution_catalog'],
								source_urls: ['https://law.example.gov/instrument.pdf'],
								source_quote: 'The employee contribution rate.'
							}
						]
					});
					const { statutory_finding } = yield* storedQuery(t, {
						statutory_finding: { where: { status: { eq: 'PROPOSED' } }, limit: 10 }
					});
					const [filed, ...others] = statutory_finding.rows;
					assert.ok(filed !== undefined);
					assert.deepEqual(others, []);
					const REPLACEMENT = 0.105;
					yield* (yield* t.as(t.admin)).act({
						'statutory_change.create': [
							{
								finding_id: filed.id,
								jurisdiction_code: CODE,
								family: 'statutory_contribution_catalog',
								row_code: ROW,
								field_path: 'lookup.employee_rate',
								old_value: LAWFUL ?? null,
								new_value: REPLACEMENT,
								effective_from: '2027-02-01',
								baseline_version_id: stood.id
							}
						]
					});
					yield* released(t, '2027-02-01');
					const replacement = yield* lawFrom(t, '2027-02-01');
					assert.notEqual(replacement.id, mistaken.id);
					assert.equal(yield* rateIn(t, replacement.id), REPLACEMENT);
					assert.equal((yield* run(t, '2027-02')).settings_id, replacement.id);
				})
			)
	);
});
