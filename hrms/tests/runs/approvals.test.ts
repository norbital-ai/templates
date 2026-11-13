// A request a policy holds for review, as an employee, a supervisor and HR drive it: nothing posts and nothing is paid
// while it waits, each decision moves it once, a rejection restores what stood, and every refusal leaves a way forward.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Caller, type Kit } from '@norbital-ai/bolt-cli/test';
import { plain_date } from '../../src/lib/date.ts';
import { Effect, Schema } from 'effect';
import { PayslipBreakdown } from '../../src/lib/payroll_engine/payslip_breakdown.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	catalogRow,
	leaveCreate,
	pack,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	storedQuery,
	current,
	decimalNumber
} from '../kit.ts';
import { decimalText } from '../../src/lib/payroll_engine/money.ts';

const NOW = '2026-02-20T02:00:00.000Z';
const CONTRACT = idOf('employee_contract', uuid(6));
const DAY = '2026-02-10';
const base = pack(
	'MY',
	'Asia/Kuala_Lumpur',
	{
		rate: { amount: 8000, unit: 'MONTHLY' },
		normal_hours_per_day: 8,
		normal_hours_per_week: 40,
		normal_days_per_week: 5,
		statutory_work_category: 'NON_MANUAL',
		work_classification: 'EA_COVERED',
		residency_status: 'CITIZEN',
		wage_payment_method: 'BANK',
		allowances: {}
	},
	{},
	[],
	[]
);
const staff = (id: number, name: string, team: string) => ({
	id: uuid(id),
	name,
	email: `${name.toLowerCase()}@example.test`,
	kind: 'staff',
	team
});
// the reviewers of the policy's flow: a supervisor, then HR; an HR manager may decide in any step's place
const reviewers = [
	staff(40, 'Lead', 'supervisor'),
	staff(41, 'Payroll', 'hr_controller'),
	staff(42, 'Chief', 'hr_manager')
];
const seed = { ...base, sys_user: [...(base.sys_user ?? []), ...reviewers] };
const people = Effect.fnUntraced(function* (t: Kit) {
	return {
		me: yield* t.as(t.member(['employee'], { id: uuid(3) })),
		lead: yield* t.as(yield* t.sign_in('lead@example.test')),
		payroll: yield* t.as(yield* t.sign_in('payroll@example.test')),
		chief: yield* t.as(yield* t.sign_in('chief@example.test'))
	};
});
const leave = (by: Caller, ...dates: readonly string[]) =>
	by
		.act({
			'leave_catalog_entry.create': [
				leaveCreate({
					entity_id: ENTITY,
					employment_id: CONTRACT,
					catalog_id: idOf('leave_catalog', catalogRow(base, 'leave_catalog', 'MEDICAL_LEAVE')),
					days: wholeDays(...dates)
				})
			]
		})
		.pipe(
			Effect.map((asked) => {
				assert.ok(asked.kind === 'pending_approval');
				const [record] = asked.records;
				assert.ok(record !== undefined);
				return { request_id: asked.request_id, id: record.id };
			})
		);
const CLAIM = idOf('claim_catalog', catalogRow(base, 'claim_catalog', 'MEDICAL_CLAIM'));
const claimOf = (quantity: number) => ({
	entity_id: ENTITY,
	employment_id: CONTRACT,
	catalog_id: CLAIM,
	quantity: decimalText(quantity),
	incurred_on: plain_date(DAY)
});
const claim = (by: Caller, quantity: number) =>
	by.act({ 'claim_catalog_entry.create': [claimOf(quantity)] }).pipe(
		Effect.map((asked) => {
			assert.ok(asked.kind === 'pending_approval');
			const [record] = asked.records;
			assert.ok(record !== undefined);
			return { request_id: asked.request_id, id: idOf('claim_catalog_entry', record.id) };
		})
	);
/** What an entry has posted to the ledger. */
const posted = (t: Kit, model: string, id: string) =>
	storedQuery(t, {
		ledger_entry: { where: { source: { eq: `${model}:${id}` } }, limit: 100 }
	}).pipe(Effect.map(({ ledger_entry }) => ledger_entry.rows.length));
const refusal = <A, E>(effect: Effect.Effect<A, E>) => Effect.flip(effect).pipe(Effect.map(String));
const approve = (by: Caller, requestId: string) =>
	by.approvals.decide(requestId, { decision: 'approve' });
const run = (t: Kit, period: string) =>
	t
		.as(t.admin)
		.pipe(
			Effect.flatMap((caller) =>
				caller.act({ 'payroll_run.create': [{ entity_id: ENTITY, period, kind: 'ON_CYCLE' }] })
			)
		)
		.pipe(Effect.andThen(t.run_due()));
/** What a period's payslip pays on a code; nothing when it has no such line. */
const paidOn = (t: Kit, period: string, code: string) =>
	storedQuery(t, { payslip: { limit: 100 }, payroll_run: { limit: 100 } }).pipe(
		Effect.map((got) => {
			const ran = got.payroll_run.rows.find((row) => row.period === period);
			const slip = got.payslip.rows.find((row) => row.payroll_run_id === ran?.id);
			assert.ok(slip !== undefined, `no payslip for ${period}`);
			return Schema.decodeUnknownSync(PayslipBreakdown)(slip.breakdown)
				.lines.filter((row) => row.code === code)
				.reduce((total, row) => total + row.amount, 0);
		})
	);
const claims = (t: Kit) =>
	storedQuery(t, { claim_catalog_entry: { limit: 100 } }).pipe(
		Effect.map(({ claim_catalog_entry }) => claim_catalog_entry.rows)
	);
const live = (rows: typeof seed = seed, now = NOW) => workspace({ seed: rows, now });

describe('who may decide a request', () => {
	it.live('the person who asked cannot decide their own', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const { me, lead } = yield* people(t);
			const asked = yield* leave(me, DAY);
			assert.match(yield* refusal(approve(me, asked.request_id)), /Only the approver may approve/);
			assert.match(
				yield* refusal(
					me.approvals.decide(asked.request_id, { decision: 'reject', reason: 'Changed my mind' })
				),
				/Only the approver or superseder may reject/
			);
			yield* approve(lead, asked.request_id);
			assert.equal(yield* posted(t, 'leave_catalog_entry', asked.id), 0);
		}).pipe(Effect.provide(live()))
	);

	// a supervisor's team holds two policies with the same limits: their own request is one act like anyone's, and a
	// reviewer who is the requester still cannot decide it
	it.live('a supervisor asks for their own leave, and another supervisor decides it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const me = yield* t.as(yield* t.sign_in('worker@example.test'));
			const deputy = yield* t.as(yield* t.sign_in('deputy@example.test'));
			const asked = yield* leave(me, DAY);
			assert.match(yield* refusal(approve(me, asked.request_id)), /Only the approver may approve/);
			yield* approve(deputy, asked.request_id);
			assert.equal(yield* posted(t, 'leave_catalog_entry', asked.id), 0);
		}).pipe(
			Effect.provide(
				live({
					...base,
					sys_user: [
						...(base.sys_user ?? []).map((row) =>
							row.id === uuid(3) ? { ...row, team: 'supervisor' } : row
						),
						...reviewers,
						staff(43, 'Deputy', 'supervisor')
					]
				})
			)
		)
	);

	it.live('each step is decided once: a second approval moves and posts nothing more', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const { me, lead, payroll } = yield* people(t);
			const asked = yield* leave(me, DAY);
			assert.equal(yield* posted(t, 'leave_catalog_entry', asked.id), 0);
			// HR's step has not come yet
			assert.match(
				yield* refusal(approve(payroll, asked.request_id)),
				/Only the approver may approve/
			);
			yield* approve(lead, asked.request_id);
			// the supervisor's step is done: their second approval is not HR's
			assert.match(
				yield* refusal(approve(lead, asked.request_id)),
				/Only the approver may approve/
			);
			assert.equal(yield* posted(t, 'leave_catalog_entry', asked.id), 0);
			yield* approve(payroll, asked.request_id);
			const once = yield* posted(t, 'leave_catalog_entry', asked.id);
			assert.ok(once > 0);
			assert.match(
				yield* refusal(approve(payroll, asked.request_id)),
				/This request is Approved; it no longer changes/
			);
			assert.match(
				yield* refusal(
					lead.approvals.decide(asked.request_id, { decision: 'reject', reason: 'Too late' })
				),
				/This request is Approved; it no longer changes/
			);
			assert.equal(yield* posted(t, 'leave_catalog_entry', asked.id), once);
		}).pipe(Effect.provide(live()))
	);

	it.live('a superseded request stands, posts once and takes no further decision', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const { me, lead, chief } = yield* people(t);
			const asked = yield* leave(me, DAY);
			// deciding in a step's place is on the record: it needs its reason
			assert.match(
				yield* refusal(approve(chief, asked.request_id)),
				/This decision needs a reason/
			);
			yield* chief.approvals.decide(asked.request_id, {
				decision: 'approve',
				reason: 'Supervisor away'
			});
			const once = yield* posted(t, 'leave_catalog_entry', asked.id);
			assert.ok(once > 0);
			assert.match(
				yield* refusal(approve(lead, asked.request_id)),
				/This request is Superseded; it no longer changes/
			);
			assert.match(
				yield* refusal(
					lead.approvals.decide(asked.request_id, { decision: 'reject', reason: 'Not agreed' })
				),
				/This request is Superseded; it no longer changes/
			);
			assert.equal(yield* posted(t, 'leave_catalog_entry', asked.id), once);
			const { leave_catalog_entry } = yield* storedQuery(t, { leave_catalog_entry: { limit: 10 } });
			assert.equal(leave_catalog_entry.rows.length, 1);
		}).pipe(Effect.provide(live()))
	);
});

describe('a rejection', () => {
	it.live('takes back the record the request made, and the day can be asked again', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const { me, lead } = yield* people(t);
			const asked = yield* leave(me, DAY);
			assert.match(
				yield* refusal(lead.approvals.decide(asked.request_id, { decision: 'reject' })),
				/This decision needs a reason/
			);
			yield* lead.approvals.decide(asked.request_id, { decision: 'reject', reason: 'Busy week' });
			const held = yield* storedQuery(t, {
				leave_catalog_entry: { limit: 10 },
				leave_catalog_entry_day: { limit: 10 }
			});
			assert.equal(held.leave_catalog_entry.rows.length, 0);
			assert.equal(held.leave_catalog_entry_day.rows.length, 0);
			assert.equal(yield* posted(t, 'leave_catalog_entry', asked.id), 0);
			// nothing of the rejected request stands in the way of the same day
			const again = yield* leave(me, DAY);
			assert.notEqual(again.request_id, asked.request_id);
		}).pipe(Effect.provide(live()))
	);

	it.live(
		'of a change to a standing claim restores the amount that stood, and that is what is paid',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const { me, lead } = yield* people(t);
				// the year's claim limit is on the balance before anyone claims
				yield* syncAll(t);
				yield* (yield* t.as(t.admin)).act({ 'claim_catalog_entry.create': [claimOf(80)] });
				const [standing] = yield* claims(t);
				assert.ok(standing !== undefined);
				const changed = yield* me.act({
					'claim_catalog_entry.update': [{ target: standing, set: { quantity: '500' } }]
				});
				assert.ok(changed.kind === 'pending_approval');
				assert.equal(decimalNumber((yield* claims(t))[0]?.quantity), 500);
				yield* lead.approvals.decide(changed.request_id, {
					decision: 'reject',
					reason: 'No receipt'
				});
				assert.equal(decimalNumber((yield* claims(t))[0]?.quantity), 80);
				yield* run(t, '2026-02');
				assert.equal(yield* paidOn(t, '2026-02', 'MEDICAL_CLAIM'), 80);
			}).pipe(Effect.provide(live()))
	);
});

describe('a withdrawal', () => {
	it.live(
		'by the person who asked takes the record back with nothing posted, and the day can be asked again',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const { me, lead } = yield* people(t);
				const asked = yield* leave(me, DAY);
				yield* me.approvals.decide(asked.request_id, { decision: 'withdraw' });
				yield* t.run_due();
				const held = yield* storedQuery(t, {
					leave_catalog_entry: { limit: 10 },
					leave_catalog_entry_day: { limit: 10 },
					approval_request: { limit: 10 }
				});
				assert.equal(held.leave_catalog_entry.rows.length, 0);
				assert.equal(held.leave_catalog_entry_day.rows.length, 0);
				assert.deepEqual(
					held.approval_request.rows.map((row) => row.status),
					['WITHDRAWN']
				);
				assert.equal(yield* posted(t, 'leave_catalog_entry', asked.id), 0);
				// withdrawn, it takes no decision, and nothing of it stands in the way of the same day
				assert.match(
					yield* refusal(approve(lead, asked.request_id)),
					/This request is Withdrawn; it no longer changes/
				);
				const again = yield* leave(me, DAY);
				assert.notEqual(again.request_id, asked.request_id);
			}).pipe(Effect.provide(live()))
	);

	it.live('is the requester’s alone: a reviewer rejects instead, and the request still waits', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const { me, lead, chief } = yield* people(t);
			const asked = yield* leave(me, DAY);
			for (const other of [lead, chief])
				assert.match(
					yield* refusal(other.approvals.decide(asked.request_id, { decision: 'withdraw' })),
					/Only the requester may withdraw/
				);
			const { leave_catalog_entry, approval_request } = yield* storedQuery(t, {
				leave_catalog_entry: { limit: 10 },
				approval_request: { limit: 10 }
			});
			assert.equal(leave_catalog_entry.rows.length, 1);
			assert.deepEqual(
				approval_request.rows.map((row) => row.status),
				['ONGOING']
			);
			// the way out the refusal leaves a reviewer: reject it, with a reason
			yield* lead.approvals.decide(asked.request_id, {
				decision: 'reject',
				reason: 'Asked in error'
			});
			assert.equal(yield* posted(t, 'leave_catalog_entry', asked.id), 0);
		}).pipe(Effect.provide(live()))
	);
});

describe('requested changes', () => {
	it.live(
		'hold the claim under review; the reviewer rejects, the person claims afresh, and that amount is paid',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const { me, lead, payroll } = yield* people(t);
				// the year's claim limit is on the balance before anyone claims
				yield* syncAll(t);
				const asked = yield* claim(me, 80);
				const save = (by: Caller, quantity: number) =>
					current(t, 'claim_catalog_entry', asked.id).pipe(
						Effect.flatMap((target) =>
							by.act({
								'claim_catalog_entry.update': [{ target, set: { quantity: decimalText(quantity) } }]
							})
						)
					);
				// while it waits on the supervisor, neither the requester nor HR changes the record under review
				assert.match(yield* refusal(save(me, 70)), /Under approval/);
				assert.match(yield* refusal(save(payroll, 70)), /Under approval/);
				assert.match(
					yield* refusal(lead.approvals.decide(asked.request_id, { decision: 'request_changes' })),
					/This decision needs a reason/
				);
				yield* lead.approvals.decide(asked.request_id, {
					decision: 'request_changes',
					reason: 'The receipt shows 60'
				});
				// nothing is approved until the requester has answered
				assert.match(
					yield* refusal(approve(lead, asked.request_id)),
					/A request in ChangesRequested cannot approve/
				);
				assert.match(yield* refusal(save(payroll, 60)), /Under approval/);
				yield* lead.approvals.decide(asked.request_id, {
					decision: 'reject',
					reason: 'Claim the 60 on the receipt'
				});
				assert.deepEqual(yield* claims(t), []);
				const again = yield* claim(me, 60);
				yield* approve(lead, again.request_id);
				yield* approve(payroll, again.request_id);
				yield* run(t, '2026-02');
				assert.equal(yield* paidOn(t, '2026-02', 'MEDICAL_CLAIM'), 60);
			}).pipe(Effect.provide(live()))
	);

	it.live(
		'on a claim: the requester’s Save resubmits the same request, and the saved amount is paid',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const { me, lead, payroll } = yield* people(t);
				yield* syncAll(t);
				const asked = yield* claim(me, 80);
				yield* lead.approvals.decide(asked.request_id, {
					decision: 'request_changes',
					reason: 'The receipt shows 60'
				});
				const saved = yield* me.act({
					'claim_catalog_entry.update': [
						{ target: yield* current(t, 'claim_catalog_entry', asked.id), set: { quantity: '60' } }
					]
				});
				assert.ok(saved.kind === 'pending_approval');
				assert.equal(saved.request_id, asked.request_id);
				assert.equal((yield* claims(t)).length, 1);
				yield* approve(lead, asked.request_id);
				yield* approve(payroll, asked.request_id);
				yield* run(t, '2026-02');
				assert.equal(yield* paidOn(t, '2026-02', 'MEDICAL_CLAIM'), 60);
			}).pipe(Effect.provide(live()))
	);

	it.live('on leave are no dead end: the reviewer rejects, and the person asks afresh', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const { me, lead, payroll } = yield* people(t);
			const asked = yield* leave(me, DAY);
			yield* lead.approvals.decide(asked.request_id, {
				decision: 'request_changes',
				reason: 'Take the Wednesday instead'
			});
			assert.match(
				yield* refusal(approve(lead, asked.request_id)),
				/A request in ChangesRequested cannot approve/
			);
			yield* lead.approvals.decide(asked.request_id, {
				decision: 'reject',
				reason: 'Ask again for the Wednesday'
			});
			assert.equal(yield* posted(t, 'leave_catalog_entry', asked.id), 0);
			const again = yield* leave(me, '2026-02-11');
			yield* approve(lead, again.request_id);
			yield* approve(payroll, again.request_id);
			assert.ok((yield* posted(t, 'leave_catalog_entry', again.id)) > 0);
			const { leave_catalog_entry } = yield* storedQuery(t, { leave_catalog_entry: { limit: 10 } });
			assert.deepEqual(
				leave_catalog_entry.rows.map((row) => row.id),
				[again.id]
			);
		}).pipe(Effect.provide(live()))
	);
});

describe('a request and the balance', () => {
	// an approval posts in its own decision and checks nothing again, so what it will draw is held from the moment it
	// is asked: a second request cannot ask for the same day of balance, and no approval is left unable to post
	const IN_LIEU = 'PUBLIC_HOLIDAY_IN_LIEU';
	const inLieu = (by: Caller, date: string) =>
		by.act({
			'leave_catalog_entry.create': [
				leaveCreate({
					entity_id: ENTITY,
					employment_id: CONTRACT,
					catalog_id: idOf('leave_catalog', catalogRow(base, 'leave_catalog', IN_LIEU)),
					days: wholeDays(date)
				})
			]
		});
	it.live(
		'still waiting, holds its days: a second request for the last day is refused with the reason; the first rejected, it is taken and approved, and posts once',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const { me, lead, payroll } = yield* people(t);
				// HR grants the one day there is
				yield* (yield* t.as(t.member(['hr_controller']))).act({
					'ledger_entry.create': [
						{
							balance_id: idOf('employee_balance', uuid(5)),
							operation: 'ADD',
							account: 'leave',
							code: IN_LIEU,
							measure: 'entitled',
							amount: '1',
							unit: 'DAY',
							effective_on: '2026-02-02',
							note: 'worked the holiday'
						}
					]
				});
				const first = yield* inLieu(me, DAY);
				assert.ok(first.kind === 'pending_approval');
				assert.match(
					yield* refusal(inLieu(me, '2026-02-11')),
					new RegExp(`${IN_LIEU}: insufficient balance`)
				);
				// the way out: the waiting request is decided, and the day is free again
				yield* lead.approvals.decide(first.request_id, {
					decision: 'reject',
					reason: 'Not that day'
				});
				const second = yield* inLieu(me, '2026-02-11');
				assert.ok(second.kind === 'pending_approval');
				const [record] = second.records;
				assert.ok(record !== undefined);
				yield* approve(lead, second.request_id);
				yield* approve(payroll, second.request_id);
				assert.ok((yield* posted(t, 'leave_catalog_entry', record.id)) > 0);
				assert.match(
					yield* refusal(inLieu(me, '2026-02-12')),
					new RegExp(`${IN_LIEU}: insufficient balance`)
				);
			}).pipe(Effect.provide(live()))
	);
});

describe('a request and the payroll run', () => {
	it.live('still waiting, holds the run that would pay it; decided, the run pays it once', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const { me, lead, payroll } = yield* people(t);
			// the year's claim limit is on the balance before anyone claims
			yield* syncAll(t);
			const asked = yield* claim(me, 80);
			// the run would seal a record under review: it is refused whole, and names who must decide
			assert.match(yield* refusal(run(t, '2026-02')), /Under approval/);
			assert.equal(
				(yield* storedQuery(t, { payroll_run: { limit: 10 } })).payroll_run.rows.length,
				0
			);
			yield* approve(lead, asked.request_id);
			yield* approve(payroll, asked.request_id);
			yield* run(t, '2026-02');
			yield* run(t, '2026-03');
			assert.equal(yield* paidOn(t, '2026-02', 'MEDICAL_CLAIM'), 80);
			assert.equal(yield* paidOn(t, '2026-03', 'MEDICAL_CLAIM'), 0);
		}).pipe(Effect.provide(live(seed, '2026-03-28T02:00:00.000Z')))
	);

	it.live('still waiting, holds the run of the very reviewer whose step it is', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const { me, lead, payroll } = yield* people(t);
			yield* syncAll(t);
			const asked = yield* claim(me, 80);
			yield* approve(lead, asked.request_id);
			// the run is not a decision: a reviewer who runs payroll neither pays the claim nor joins its request
			assert.match(
				yield* refusal(
					payroll.act({
						'payroll_run.create': [{ entity_id: ENTITY, period: '2026-02', kind: 'ON_CYCLE' }]
					})
				),
				/Under approval/
			);
			assert.equal(
				(yield* storedQuery(t, { payroll_run: { limit: 10 } })).payroll_run.rows.length,
				0
			);
			assert.equal(yield* posted(t, 'claim_catalog_entry', asked.id), 0);
		}).pipe(Effect.provide(live(seed, '2026-03-28T02:00:00.000Z')))
	);

	it.live(
		'saved again without a change while it waits, posts nothing; rejected, it leaves nothing behind',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const { me, lead } = yield* people(t);
				yield* syncAll(t);
				const asked = yield* claim(me, 80);
				// a save that changes nothing is no write, yet the entry's body still answers with its postings
				yield* Effect.exit(
					Effect.all([t.as(t.admin), current(t, 'claim_catalog_entry', asked.id)]).pipe(
						Effect.flatMap(([caller, target]) =>
							caller.act({ 'claim_catalog_entry.update': [{ target, set: { quantity: '80' } }] })
						)
					)
				);
				yield* t.run_due();
				assert.equal(yield* posted(t, 'claim_catalog_entry', asked.id), 0);
				yield* lead.approvals.decide(asked.request_id, {
					decision: 'reject',
					reason: 'Not covered'
				});
				yield* t.run_due();
				assert.equal(yield* posted(t, 'claim_catalog_entry', asked.id), 0);
				assert.equal((yield* claims(t)).length, 0);
			}).pipe(Effect.provide(live(seed, '2026-03-28T02:00:00.000Z')))
	);

	it.live('rejected while the run waited, is never paid', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const { me, lead } = yield* people(t);
			// the year's claim limit is on the balance before anyone claims
			yield* syncAll(t);
			const asked = yield* claim(me, 80);
			assert.match(yield* refusal(run(t, '2026-02')), /Under approval/);
			yield* lead.approvals.decide(asked.request_id, { decision: 'reject', reason: 'Not covered' });
			yield* run(t, '2026-02');
			assert.equal(yield* paidOn(t, '2026-02', 'MEDICAL_CLAIM'), 0);
			assert.equal((yield* claims(t)).length, 0);
		}).pipe(Effect.provide(live()))
	);

	it.live('approved after its month is paid, is carried by the next run and by no other', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const { me, lead, payroll } = yield* people(t);
			// the year's claim limit is on the balance before anyone claims
			yield* syncAll(t);
			yield* run(t, '2026-02');
			// an unpaid run holds its person: the month is paid before anything late is keyed into it
			const [february] = (yield* storedQuery(t, { payroll_run: { limit: 10 } })).payroll_run.rows;
			assert.ok(february !== undefined);
			yield* (yield* t.as(t.admin)).act({
				'payroll_run.update': [{ target: february, set: { state: 'PAID' } }]
			});
			yield* t.run_due();
			const asked = yield* claim(me, 80);
			yield* approve(lead, asked.request_id);
			yield* approve(payroll, asked.request_id);
			assert.equal(yield* paidOn(t, '2026-02', 'MEDICAL_CLAIM'), 0);
			yield* run(t, '2026-03');
			yield* run(t, '2026-04');
			assert.equal(yield* paidOn(t, '2026-03', 'MEDICAL_CLAIM'), 80);
			assert.equal(yield* paidOn(t, '2026-04', 'MEDICAL_CLAIM'), 0);
			const runs = (yield* storedQuery(t, { payroll_run: { limit: 10 } })).payroll_run.rows;
			const [paid] = yield* claims(t);
			assert.equal(paid?.payroll_run_id, runs.find((row) => row.period === '2026-03')?.id);
		}).pipe(Effect.provide(live(seed, '2026-04-28T02:00:00.000Z')))
	);
});
