// A change of law keyed by mistake is corrected where it stands: edited, moved or deleted, or its research finding
// rejected. A run prices on the law of its pay date, so the write that corrects the change amends the paid periods it
// reached, and the next run carries the difference. The change is one contribution rate of the fixture pack, and every
// expected figure is one the test chose or the system itself produced.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { JobResult, TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import type { JsonObject } from '../../src/lib/payroll_engine/contracts.ts';
import type { Json } from '../../src/lib/payroll_engine/foundation.ts';
import { objectValue } from '../../src/lib/payroll_engine/reads.ts';
import { amendments, carriedFor, dropped, ownLines, pay, run } from '../amendment_kit.ts';
import { lawAt, pack, refusal, storedQuery, workspace, packTerms } from '../kit.ts';

const CODE = 'MY';
const NOW = '2027-02-05T02:00:00.000Z';
const ROW = 'EPF';
const LINE = `${ROW}/EMPLOYEE`;
const WAGE = 10_000;
/** The first day the mistaken change is keyed for: the fixture's law has no change of its own on or after it. */
const FROM = '2027-02-01';
const SEED = pack(CODE, 'Asia/Kuala_Lumpur', packTerms(WAGE), {}, [], []);
/** The row's table as the law in force holds it, its rate, and the one the mistaken change keys instead. */
const LOOKUP = objectValue(
	lawAt(CODE, NOW.slice(0, 10)).rows.statutory_contribution_catalog.find((row) => row.code === ROW)
		?.lookup
);
const LAWFUL = LOOKUP.employee_rate ?? null;
const MISTAKEN = 0.125;
/** A patch is read three keys deep, so a change to one rate carries the row's whole table. */
const rated = (rate: Json): JsonObject => ({
	statutory_contribution_catalog: { [ROW]: { lookup: { ...LOOKUP, employee_rate: rate } } }
});
const answer = (value: unknown) => ({
	content: JSON.stringify(value),
	tool_calls: [],
	finish: 'stop' as const,
	usage: { input: 0, output: 0 }
});
/** One research pass: an instrument found, then its one change to the row's employee rate. */
const found = (rate: unknown, from: string) => [
	answer({
		findings: [
			{
				instrument: 'Instrument 1',
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
	body: (t: Kit) => Effect.Effect<void, unknown>,
	turns: readonly ReturnType<typeof answer>[] = [],
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
/** The one change filed on or after `FROM`, as stored now. */
const filed = (t: Kit) =>
	storedQuery(t, {
		jurisdiction_change: {
			where: { jurisdiction_code: { eq: CODE }, effective_from: { gte: FROM } },
			limit: 10
		}
	}).pipe(
		Effect.map(({ jurisdiction_change }) => {
			const [row, ...others] = jurisdiction_change.rows;
			assert.ok(row !== undefined, 'No change is filed');
			assert.deepEqual(others, []);
			return row;
		})
	);
/** HR keys the mistaken change from `FROM`. */
const keyed = (t: Kit) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'jurisdiction_change.create': [
				{ jurisdiction_code: CODE, effective_from: FROM, law: rated(MISTAKEN) }
			]
		});
		yield* t.run_due();
	});
const edited = (t: Kit, law: JsonObject) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'jurisdiction_change.update': [{ target: yield* filed(t), set: { law } }]
		});
		yield* t.run_due();
	});
const moved = (t: Kit, to: string) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'jurisdiction_change.update': [{ target: yield* filed(t), set: { effective_from: to } }]
		});
		yield* t.run_due();
	});
const deleted = (t: Kit) =>
	Effect.gen(function* () {
		yield* (yield* t.as(t.admin)).act({
			'jurisdiction_change.delete': [{ target: yield* filed(t) }]
		});
		yield* t.run_due();
	});
/** The one finding on file moved to a state by a person. */
const decided = (t: Kit, status: 'CONFIRMED' | 'REJECTED') =>
	Effect.gen(function* () {
		const { statutory_finding } = yield* storedQuery(t, { statutory_finding: { limit: 10 } });
		const [finding, ...others] = statutory_finding.rows;
		assert.ok(finding !== undefined, 'Nothing is on file');
		assert.deepEqual(others, []);
		yield* (yield* t.as(t.admin)).act({
			'statutory_finding.update': [{ target: finding, set: { status } }]
		});
		yield* t.run_due();
	});
/** What the row charged the employee on a period's own payslip lines. */
const charged = (t: Kit, period: string) =>
	ownLines(t, period).pipe(Effect.map((lines) => lines[LINE] ?? 0));
const march = (t: Kit) =>
	Effect.sync(() => t.clock.set('2027-03-05T02:00:00.000Z')).pipe(
		Effect.andThen(run(t, '2027-03'))
	);

describe('a law change keyed by mistake', () => {
	it.live(
		'under an unpaid run it does not move: the run is deleted, the change corrected, and the run made again prices on the corrected law',
		() =>
			scenario((t) =>
				Effect.gen(function* () {
					assert.notEqual(MISTAKEN, LAWFUL);
					yield* keyed(t);
					// what it moves: every run whose pay date it covers
					const made = yield* run(t, '2027-02');
					const mistaken = yield* charged(t, '2027-02');
					const held = yield* refusal(edited(t, rated(LAWFUL)));
					assert.equal(held.key, 'errors.payroll_refused');
					assert.match(String(held.values?.message), /Run 1 holds this person and is not paid yet/);
					assert.deepEqual((yield* filed(t)).law, rated(MISTAKEN));
					// the run made under the mistake keeps its figures until it is deleted and run again
					assert.equal(yield* charged(t, '2027-02'), mistaken);
					yield* dropped(t, made);
					yield* edited(t, rated(LAWFUL));
					yield* run(t, '2027-02');
					assert.ok(mistaken < (yield* charged(t, '2027-02')), 'the mistaken rate charged more');
					assert.deepEqual(yield* amendments(t), []);
				})
			)
	);

	for (const [fix, corrected] of [
		['edited', (t: Kit) => edited(t, rated(LAWFUL))],
		['deleted', deleted]
	] as const)
		it.live(
			`${fix} after its run was paid: everyone paid under it is amended, and the next run carries the difference`,
			() =>
				scenario((t) =>
					Effect.gen(function* () {
						yield* keyed(t);
						yield* pay(t, '2027-02');
						const paid = yield* ownLines(t, '2027-02');
						assert.deepEqual(yield* amendments(t), []);
						// the change reached the paid run's pay date: its people are amended by the write itself
						yield* corrected(t);
						assert.deepEqual(
							(yield* amendments(t)).map((row) => [row.period, row.payroll_run_id]),
							[['2027-02', null]]
						);
						yield* march(t);
						// March pays the same wage on the corrected law: what February should have charged, less what it did
						const own = yield* charged(t, '2027-03');
						const wrong = paid[LINE] ?? 0;
						assert.ok(wrong < own, 'the mistaken rate charged more');
						assert.equal(
							(yield* carriedFor(t, '2027-03', '2027-02'))[LINE],
							Number((own - wrong).toFixed(2))
						);
						assert.deepEqual(yield* ownLines(t, '2027-02'), paid, 'the paid payslip stands');
					})
				)
		);

	it.live(
		'dated a month early and moved after that month was paid: the month is amended, and the change holds from its real date',
		() =>
			scenario((t) =>
				Effect.gen(function* () {
					yield* keyed(t);
					yield* pay(t, '2027-02');
					const wrong = yield* charged(t, '2027-02');
					yield* moved(t, '2027-03-01');
					assert.deepEqual(
						(yield* amendments(t)).map((row) => [row.period, row.payroll_run_id]),
						[['2027-02', null]]
					);
					yield* march(t);
					// March is the change's own month now: the same wage, charged what February was
					assert.equal(yield* charged(t, '2027-03'), wrong);
					// and February is worked out on the law of its own pay date: part of its charge comes back
					const back = (yield* carriedFor(t, '2027-03', '2027-02'))[LINE] ?? 0;
					assert.ok(back > 0, 'February was charged too much');
					assert.ok(back < -wrong);
				})
			)
	);

	it.live(
		'filed by research: out of force until its finding is confirmed, and rejecting the finding takes it out again and amends what it reached',
		() =>
			scenario(
				(t) =>
					Effect.gen(function* () {
						yield* (yield* t.as(t.admin)).run('statutory_research', { code: CODE }, JobResult);
						yield* t.run_due();
						assert.deepEqual((yield* filed(t)).law, rated(MISTAKEN));
						// proposed, the change prices nothing
						const lawful = yield* run(t, '2027-02').pipe(
							Effect.andThen((made) =>
								charged(t, '2027-02').pipe(Effect.tap(() => dropped(t, made)))
							)
						);
						yield* decided(t, 'CONFIRMED');
						yield* pay(t, '2027-02');
						const paid = yield* ownLines(t, '2027-02');
						const wrong = paid[LINE] ?? 0;
						assert.ok(wrong < lawful, 'the mistaken rate charged more');
						assert.deepEqual(yield* amendments(t), []);
						yield* decided(t, 'REJECTED');
						assert.deepEqual(
							(yield* amendments(t)).map((row) => [row.period, row.payroll_run_id]),
							[['2027-02', null]]
						);
						yield* march(t);
						assert.equal(yield* charged(t, '2027-03'), lawful);
						assert.equal(
							(yield* carriedFor(t, '2027-03', '2027-02'))[LINE],
							Number((lawful - wrong).toFixed(2))
						);
						assert.deepEqual(yield* ownLines(t, '2027-02'), paid, 'the paid payslip stands');
					}),
				found(MISTAKEN, FROM)
			)
	);

	it.live(
		'a law with no change in force prices nothing: the run is refused by law and pay date',
		() =>
			scenario(
				(t) =>
					Effect.gen(function* () {
						const lawless = yield* refusal(run(t, '2027-02'));
						assert.equal(lawless.key, 'errors.payroll_run_no_law');
						assert.equal(lawless.values?.code, CODE);
						assert.match(String(lawless.values?.date), /^2027-02-\d\d$/);
					}),
				[],
				{ ...SEED, jurisdiction_change: [] }
			)
	);
});
