// A person's documents sit on their profile, not on the sealed contract: HR or the person uploads them, the kiosk never
// sees them, and no one else may touch them. An employee reaches their own records only: a colleague's are not theirs
// to read, so a write that names one is refused before any policy check runs.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	pack,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	leaveCreate,
	query,
	storedQuery,
	refusal,
	decimalNumber
} from '../kit.ts';

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
const seed = pack('MY', 'Asia/Kuala_Lumpur', terms, {}, [], []);
/** The profile as stored now: a write's target at its current revision. */
const profile = (t: Kit) =>
	storedQuery(t, { employee_profile: { where: { id: { eq: PROFILE } }, limit: 1 } }).pipe(
		Effect.map(({ employee_profile }) => {
			const [row] = employee_profile.rows;
			assert.ok(row !== undefined);
			return row;
		})
	);
const file = {
	name: 'birth.pdf',
	mime: 'application/pdf',
	bytes: new TextEncoder().encode('%PDF-1.7')
};

describe("a profile's documents", () => {
	it.live("take the person's own upload, and no one else's", () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const me = yield* t.as(t.member(['employee'], { id: uuid(3) }));
			const uploaded = yield* me.upload('employee_profile.documents', file);
			assert.ok(uploaded.kind === 'committed');
			yield* me.act({
				'employee_profile.update': [
					{ target: yield* profile(t), set: { documents: [uploaded.output] } }
				]
			});
			const [stored] = (yield* storedQuery(t, { employee_profile: { limit: 1 } })).employee_profile
				.rows;
			assert.equal(stored?.documents?.length, 1);
			assert.match(
				String(
					yield* Effect.flip(
						Effect.all([t.as(t.member(['employee'])), profile(t)]).pipe(
							Effect.andThen(([caller, target]) =>
								caller.act({ 'employee_profile.update': [{ target, set: { documents: [] } }] })
							)
						)
					)
				),
				/The record does not exist/
			);
			const device = yield* t.as(t.member(['kiosk']));
			const kiosk = yield* query(t, device, { employee_profile: { output: 'kiosk', limit: 1 } });
			assert.equal(kiosk.employee_profile.rows[0]?.name, 'Worker');
			assert.ok(!('documents' in (kiosk.employee_profile.rows[0] ?? {})));
			// the kiosk enrols a face and nothing else: it cannot suspend one, and the enrolment itself passes
			const enrol = (face_enrollment_status: 'APPROVED' | 'SUSPENDED') =>
				profile(t).pipe(
					Effect.andThen((target) =>
						device.act({ 'employee_profile.update': [{ target, set: { face_enrollment_status } }] })
					)
				);
			assert.equal((yield* refusal(enrol('SUSPENDED'))).key, 'errors.kiosk_face_enrollment_undo');
			assert.equal((yield* enrol('APPROVED')).kind, 'committed');
		}).pipe(Effect.provide(workspace({ seed, now: NOW })))
	);
});

describe('a person asking for leave', () => {
	// a colleague of the same company, with a login, a profile and an employment of their own
	const colleagues = {
		...seed,
		sys_user: [
			...(seed.sys_user ?? []),
			{ id: uuid(50), name: 'Colleague', email: 'colleague@example.test', kind: 'staff' }
		],
		employee_profile: [
			...(seed.employee_profile ?? []),
			{ id: uuid(51), user_id: uuid(50), name: 'Colleague' }
		],
		employee_contract: [
			...(seed.employee_contract ?? []),
			...(seed.employee_contract ?? []).map((row) => ({
				...row,
				id: uuid(52),
				employee_id: uuid(51),
				employee_number: 'W2'
			}))
		]
	};
	it.live(
		'files a leave request and a claim for review on their own employment; a colleague can file neither, nor edit the claim',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* syncAll(t);
				const mine = { entity_id: ENTITY, employment_id: idOf('employee_contract', uuid(6)) };
				const leave = leaveCreate({
					...mine,
					catalog_code: 'MEDICAL_LEAVE',
					days: wholeDays('2026-11-03')
				});
				const claim = {
					...mine,
					catalog_code: 'MEDICAL_CLAIM',
					quantity: '80',
					incurred_on: '2026-11-03'
				};
				const me = yield* t.as(t.member(['employee'], { id: uuid(3) }));
				const other = yield* t.as(t.member(['employee'], { id: uuid(50) }));
				const refusedText = <A, E>(effect: Effect.Effect<A, E>) =>
					Effect.flip(effect).pipe(Effect.map(String));
				// the colleague reads the company, never my employment: the link itself is refused
				const UNREADABLE = /No readable employee_contract has this id/;
				assert.match(
					yield* refusedText(other.act({ 'leave_catalog_entry.create': [leave] })),
					UNREADABLE
				);
				assert.match(
					yield* refusedText(other.act({ 'claim_catalog_entry.create': [claim] })),
					UNREADABLE
				);
				assert.equal(
					(yield* me.act({ 'leave_catalog_entry.create': [leave] })).kind,
					'pending_approval'
				);
				const asked = yield* me.act({ 'claim_catalog_entry.create': [claim] });
				assert.ok(asked.kind === 'pending_approval');
				const [mineClaim] = asked.records;
				assert.ok(mineClaim !== undefined);
				assert.match(
					yield* refusedText(
						other.act({
							'claim_catalog_entry.update': [
								{
									target: {
										id: idOf('claim_catalog_entry', mineClaim.id),
										revision: mineClaim.revision
									},
									set: { quantity: '800' }
								}
							]
						})
					),
					/The record does not exist/
				);
				const stored = yield* storedQuery(t, {
					leave_catalog_entry: { limit: 10 },
					claim_catalog_entry: { limit: 10 }
				});
				assert.equal(stored.leave_catalog_entry.rows.length, 1);
				assert.deepEqual(
					stored.claim_catalog_entry.rows.map((row) => decimalNumber(row.quantity)),
					[80]
				);
			}).pipe(Effect.provide(workspace({ seed: colleagues, now: NOW })))
	);
});
