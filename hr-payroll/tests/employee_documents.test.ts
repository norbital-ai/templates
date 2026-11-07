// A person's documents sit on their profile, not on the sealed contract: HR or the person uploads them, the kiosk never
// sees them, and no one else may touch them.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ENTITY, catalogRow, pack, syncAll, uuid, wholeDays, workspace } from './kit.ts';

const NOW = '2026-11-20T02:00:00.000Z';
const PROFILE = idOf('employee_profile', uuid(4));
const terms = {
	rate: { amount: 8000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
const seed = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], [], '2026-11-15');
const file = {
	name: 'birth.pdf',
	mime: 'application/pdf',
	bytes: new TextEncoder().encode('%PDF-1.7')
};

describe("a profile's documents", () => {
	it.live("take the person's own upload, and no one else's", () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const me = t.as(t.member(['employee'], { id: uuid(3) }));
			const uploaded = yield* me.upload('employee_profile.documents', file);
			assert.ok(uploaded.kind === 'committed');
			yield* me.act('employee_profile.update', [
				{ target: PROFILE, set: { documents: [uploaded.output] } }
			]);
			const [stored] = (yield* t.storedQuery({ employee_profile: { limit: 1 } })).employee_profile
				.rows;
			assert.equal(stored?.documents?.length, 1);
			yield* Effect.flip(
				t
					.as(t.member(['employee']))
					.act('employee_profile.update', [{ target: PROFILE, set: { documents: [] } }])
			);
			const kiosk = yield* t
				.as(t.member(['kiosk']))
				.query({ employee_profile: { output: 'kiosk', limit: 1 } });
			assert.equal(kiosk.employee_profile.rows[0]?.name, 'Worker');
			assert.ok(!('documents' in (kiosk.employee_profile.rows[0] ?? {})));
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('a person asking for leave', () => {
	it.live('files a request for review, and reaches no other employment', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			const request = {
				entity_id: ENTITY,
				employment_id: idOf('employee_contract', uuid(6)),
				catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', 'MEDICAL_LEAVE')),
				days: wholeDays('2026-11-03')
			};
			const held = yield* t
				.as(t.member(['employee'], { id: uuid(3) }))
				.act('leave_catalog_entry.create', [request]);
			assert.equal(held.kind, 'pendingApproval');
			const refused = yield* Effect.flip(
				t.as(t.member(['employee'])).act('leave_catalog_entry.create', [request])
			);
			assert.match(String(refused), /No readable entity/);
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
	const reviewed = {
		...seed,
		sys_user: [
			...(seed.sys_user ?? []),
			{ id: uuid(40), name: 'Lead', email: 'lead@example.test', kind: 'staff', team: 'supervisor' },
			{
				id: uuid(41),
				name: 'Payroll',
				email: 'payroll@example.test',
				kind: 'staff',
				team: 'hr_controller'
			}
		]
	};
	it.live(
		'posts nothing while it waits, posts in the approving decision, and never once rejected',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const me = t.as(t.member(['employee'], { id: uuid(3) }));
				const lead = t.as(yield* t.signIn('lead@example.test')),
					payroll = t.as(yield* t.signIn('payroll@example.test'));
				const ask = (day: string) =>
					me.act('leave_catalog_entry.create', [
						{
							entity_id: ENTITY,
							employment_id: idOf('employee_contract', uuid(6)),
							catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', 'MEDICAL_LEAVE')),
							days: wholeDays(day)
						}
					]);
				const posted = (id: string) =>
					t
						.storedQuery({
							ledger_entry: { where: { source: { eq: `leave_catalog_entry:${id}` } }, limit: 100 }
						})
						.pipe(Effect.map(({ ledger_entry }) => ledger_entry.rows.length));
				const granted = yield* ask('2026-11-03');
				assert.ok(granted.kind === 'pendingApproval');
				const [leave] = granted.records;
				assert.ok(leave !== undefined);
				assert.equal(yield* posted(leave.id), 0);
				yield* lead.approvals.decide(granted.requestId, { decision: 'approve' });
				assert.equal(yield* posted(leave.id), 0);
				yield* payroll.approvals.decide(granted.requestId, { decision: 'approve' });
				assert.ok((yield* posted(leave.id)) > 0);
				const turned = yield* ask('2026-11-04');
				assert.ok(turned.kind === 'pendingApproval');
				const [other] = turned.records;
				assert.ok(other !== undefined);
				yield* lead.approvals.decide(turned.requestId, { decision: 'reject', reason: 'Busy week' });
				assert.equal(yield* posted(other.id), 0);
			}).pipe(Effect.provide(workspace({ seed: reviewed, now: NOW })))
	);
});
