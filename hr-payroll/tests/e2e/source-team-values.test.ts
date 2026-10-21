import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import type { ActInput } from '@norbital-ai/bolt';
import { Authorities, Approvals } from '@norbital-ai/bolt/engine';
import { workspace } from '../kit.ts';

const HR_MANAGER = '019f8a10-0000-7000-8000-000000000006';
const HR_CONTROLLER = '019f8a10-0000-7000-8000-000000000005';
const EMPLOYEE = '019f8a10-0000-7000-8000-000000000001';
const NOW = '2026-10-13T00:00:00.000Z';
const kinds = [
	{
		code: 'CLOSURE',
		name: 'Closure',
		counts_as_attended: 'true',
		scheduled: 'true',
		pay: '0.6 * terms.base_salary / 26.0'
	}
];
const draft = {
	code: 'test',
	jurisdiction_code: 'test',
	name: 'Test version',
	payroll: { currency: 'USD' },
	sources: { entries: [] },
	effective_range: { from: '2026-01-01', to: null },
	suspension_kinds: kinds
} satisfies ActInput<'jurisdiction_settings.create'>;

it.live(
	'stores validated suspension kinds on their version, clones them and refuses sealed changes',
	() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = t.as(t.admin);
			const created = yield* admin.act('jurisdiction_settings.create', draft);
			expect(created.kind, JSON.stringify(created)).toBe('committed');
			if (created.kind !== 'committed') throw new Error('The draft did not commit.');
			const id = created.records.find((row) => row.collection === 'jurisdiction_settings')?.id;
			if (id === undefined) throw new Error('The draft record is absent.');
			expect(t.manifest.models['suspension_kind']).toBeUndefined();
			expect(
				(yield* admin.get('jurisdiction_settings', id, { select: { suspension_kinds: true } }))
					?.suspension_kinds
			).toEqual(kinds);
			for (const invalid of [[...kinds, ...kinds], [{ code: ' ', name: 'Blank' }]]) {
				const refused = yield* Effect.flip(
					admin.act('jurisdiction_settings.update', {
						target: id,
						set: { suspension_kinds: invalid }
					})
				);
				expect(refused).toMatchObject({
					_tag: 'ActRefused',
					message: expect.stringContaining('distinct non-empty codes')
				});
			}
			expect(
				(yield* admin.act('jurisdiction_settings.update', { target: id, set: { sealed_at: NOW } }))
					.kind
			).toBe('committed');
			expect(
				yield* Effect.flip(
					admin.act('jurisdiction_settings.update', {
						target: id,
						set: { suspension_kinds: [] }
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
			const { suspension_kinds, ...cloneFields } = draft;
			const cloned = yield* admin.act('jurisdiction_settings.create', {
				...cloneFields,
				cloned_from_id: id,
				effective_range: { from: '2027-01-01', to: null }
			});
			expect(cloned.kind, JSON.stringify(cloned)).toBe('committed');
			if (cloned.kind !== 'committed') throw new Error('The successor did not commit.');
			const successor = cloned.records.find(
				(row) => row.collection === 'jurisdiction_settings'
			)?.id;
			if (successor === undefined) throw new Error('The successor record is absent.');
			expect(
				yield* admin.get('jurisdiction_settings', successor, {
					select: { suspension_kinds: true, sealed_at: true }
				})
			).toMatchObject({ suspension_kinds: kinds, sealed_at: null });
			expect(
				(yield* admin.act('jurisdiction_settings.update', {
					target: successor,
					set: { suspension_kinds: [] }
				})).kind
			).toBe('committed');
			expect(
				(yield* admin.get('jurisdiction_settings', id, { select: { suspension_kinds: true } }))
					?.suspension_kinds
			).toEqual(kinds);
		}).pipe(Effect.provide(workspace({ seed: 'none', now: NOW })), Effect.scoped),
	{ timeout: 600_000 }
);

it.live(
	'resolves source team grants and approval eligibility; teams have no runtime catalogue',
	() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			expect(t.manifest.teams[HR_MANAGER]).toMatchObject({
				name: 'HR Manager',
				parent: null,
				policies: ['hr_manager']
			});
			const reviewer = t.member([], { email: 'reviewer@example.com' });
			const controller = t.member([], { email: 'controller@example.com' });
			const employee = t.member([], { email: 'employee@example.com' });
			yield* t.db.write({
				text: 'UPDATE sys_user SET team = CASE WHEN id = $1 THEN $4 WHEN id = $2 THEN $5 ELSE $6 END, revision = revision + 1 WHERE id IN ($1, $2, $3)',
				params: [reviewer.id, controller.id, employee.id, HR_MANAGER, HR_CONTROLLER, EMPLOYEE]
			});
			// teams are source-only: no `sys_team` collection exists to edit or read
			expect(t.manifest.collections['sys_team']).toBeUndefined();
			const admin = t.as(t.admin);
			const authorities = new Authorities(t.manifest, 'payroll-source-teams');
			const authority = yield* authorities.member(t.db, reviewer.id);
			const controllerAuthority = yield* authorities.member(t.db, controller.id);
			expect(authority?.policies).toContain('hr_manager');
			expect((yield* authorities.member(t.db, employee.id))?.policies).toEqual(['employee']);
			if (authority === null || controllerAuthority === null)
				throw new Error('Seeded staff authority is absent.');
			const created = yield* t.as(controllerAuthority).act('jurisdiction_settings.create', draft);
			expect(created.kind, JSON.stringify(created)).toBe('committed');
			if (created.kind !== 'committed') throw new Error('The controller draft did not commit.');
			const id = created.records.find((row) => row.collection === 'jurisdiction_settings')?.id;
			if (id === undefined) throw new Error('The controller draft is absent.');
			const approvals = yield* Approvals;
			const sealedAt = () =>
				t.as(authority).get('jurisdiction_settings', id, { select: { sealed_at: true } });
			const seal = Effect.fnUntraced(function* () {
				const held = yield* t
					.as(controllerAuthority)
					.act('jurisdiction_settings.update', { target: id, set: { sealed_at: NOW } });
				expect(held.kind, JSON.stringify(held)).toBe('pendingApproval');
				if (held.kind !== 'pendingApproval') throw new Error('The seal was not routed.');
				return held.requestId;
			});
			const move = (
				requestId: string,
				status: 'APPROVED' | 'REJECTED' | 'REQUEST_FOR_CHANGE' | 'RESUBMITTED',
				by = authority
			) =>
				approvals.process({
					requestId,
					status,
					authority: by,
					now: NOW,
					...(status === 'REQUEST_FOR_CHANGE' ? { reason: 'Recheck the sources' } : {})
				});
			// The seal is applied at once and held: nobody outside the request, an administrator included, may void it.
			const rejected = yield* seal();
			expect(yield* sealedAt()).toMatchObject({ sealed_at: NOW });
			expect(
				yield* Effect.flip(
					admin.act('jurisdiction_settings.update', {
						target: id,
						set: { voided_at: NOW, void_reason: 'Around the review' }
					})
				)
			).toMatchObject({ _tag: 'ActRefused', code: 'locked' });
			// A rejection rolls the seal back.
			expect(yield* move(rejected, 'REJECTED')).toMatchObject({
				kind: 'decided',
				status: 'REJECTED'
			});
			expect(yield* sealedAt()).toMatchObject({ sealed_at: null });
			// A request for change leaves the seal with the controller, who resubmits; approval keeps it.
			const requestId = yield* seal();
			expect(yield* move(requestId, 'REQUEST_FOR_CHANGE')).toMatchObject({
				status: 'CHANGES_REQUESTED'
			});
			expect(yield* sealedAt()).toMatchObject({ sealed_at: NOW });
			expect(yield* move(requestId, 'RESUBMITTED', controllerAuthority)).toMatchObject({
				status: 'ONGOING'
			});
			const decision = yield* move(requestId, 'APPROVED');
			expect(decision, JSON.stringify(decision)).toMatchObject({
				kind: 'decided',
				status: 'APPROVED'
			});
			expect(yield* sealedAt()).toMatchObject({ sealed_at: NOW });
			yield* t.db.write({
				text: 'UPDATE sys_user SET team = $2, revision = revision + 1 WHERE id = $1',
				params: [reviewer.id, EMPLOYEE]
			});
			expect((yield* authorities.member(t.db, reviewer.id))?.policies).toEqual(['employee']);
		}).pipe(Effect.provide(workspace({ now: NOW })), Effect.scoped),
	{ timeout: 600_000 }
);
