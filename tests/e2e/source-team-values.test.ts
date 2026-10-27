import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import type { ActInput } from '@norbital-ai/bolt';
import { Authorities, Approvals } from '@norbital-ai/bolt/engine';
import { workspace } from '../kit.ts';

const HR_MANAGER = 'hr_manager';
const HR_CONTROLLER = 'hr_controller';
const EMPLOYEE = 'employee';
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
} satisfies ActInput<'jurisdiction_settings.create'>[number];

it.live(
	'stores validated suspension kinds on their version, clones them and refuses sealed changes',
	() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const admin = t.as(t.admin);
			const created = yield* admin.act('jurisdiction_settings.create', [draft]);
			expect(created.kind, JSON.stringify(created)).toBe('committed');
			if (created.kind !== 'committed') throw new Error('The draft did not commit.');
			const id = created.records.find((row) => row.model === 'jurisdiction_settings')?.id;
			if (id === undefined) throw new Error('The draft record is absent.');
			expect(
				(yield* admin.query({
					jurisdiction_settings: { where: { id: { eq: id } }, fields: ['suspension_kinds'] }
				})).jurisdiction_settings.rows[0]?.suspension_kinds
			).toEqual(kinds);
			for (const invalid of [[...kinds, ...kinds], [{ code: ' ', name: 'Blank' }]]) {
				const refused = yield* Effect.flip(
					admin.act('jurisdiction_settings.update', [
						{
							target: id,
							set: { suspension_kinds: invalid }
						}
					])
				);
				expect(refused).toMatchObject({
					_tag: 'ActRefused',
					message: expect.stringContaining('distinct non-empty codes')
				});
			}
			expect(
				(yield* admin.act('jurisdiction_settings.update', [
					{ target: id, set: { sealed_at: NOW } }
				])).kind
			).toBe('committed');
			expect(
				yield* Effect.flip(
					admin.act('jurisdiction_settings.update', [
						{
							target: id,
							set: { suspension_kinds: [] }
						}
					])
				)
			).toMatchObject({ _tag: 'ActRefused' });
			const { suspension_kinds, ...cloneFields } = draft;
			const cloned = yield* admin.act('jurisdiction_settings.create', [
				{
					...cloneFields,
					cloned_from_id: id,
					effective_range: { from: '2027-01-01', to: null }
				}
			]);
			expect(cloned.kind, JSON.stringify(cloned)).toBe('committed');
			if (cloned.kind !== 'committed') throw new Error('The successor did not commit.');
			const successor = cloned.records.find(
				(row) => row.model === 'jurisdiction_settings'
			)?.id;
			if (successor === undefined) throw new Error('The successor record is absent.');
			expect(
				(yield* admin.query({
					jurisdiction_settings: {
						where: { id: { eq: successor } },
						fields: ['suspension_kinds', 'sealed_at']
					}
				})).jurisdiction_settings.rows[0]
			).toMatchObject({ suspension_kinds: kinds, sealed_at: null });
			expect(
				(yield* admin.act('jurisdiction_settings.update', [
					{
						target: successor,
						set: { suspension_kinds: [] }
					}
				])).kind
			).toBe('committed');
			expect(
				(yield* admin.query({
					jurisdiction_settings: { where: { id: { eq: id } }, fields: ['suspension_kinds'] }
				})).jurisdiction_settings.rows[0]?.suspension_kinds
			).toEqual(kinds);
		}).pipe(Effect.provide(workspace({ seed: 'none', now: NOW })), Effect.scoped),
	{ timeout: 600_000 }
);

it.live(
	'resolves source team grants and approval eligibility',
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
			const admin = t.as(t.admin);
			const authorities = new Authorities(t.manifest, 'payroll-source-teams');
			const authority = yield* authorities.member(t.db, reviewer.id);
			const controllerAuthority = yield* authorities.member(t.db, controller.id);
			expect(authority?.policies).toContain('hr_manager');
			expect((yield* authorities.member(t.db, employee.id))?.policies).toEqual(['employee']);
			if (authority === null || controllerAuthority === null)
				throw new Error('Seeded staff authority is absent.');
			const created = yield* t.as(controllerAuthority).act('jurisdiction_settings.create', [draft]);
			expect(created.kind, JSON.stringify(created)).toBe('committed');
			if (created.kind !== 'committed') throw new Error('The controller draft did not commit.');
			const id = created.records.find((row) => row.model === 'jurisdiction_settings')?.id;
			if (id === undefined) throw new Error('The controller draft is absent.');
			const approvals = yield* Approvals;
			const sealedAt = () =>
				t
					.as(authority)
					.query({ jurisdiction_settings: { where: { id: { eq: id } }, fields: ['sealed_at'] } })
					.pipe(Effect.map((answer) => answer.jurisdiction_settings.rows[0] ?? null));
			const seal = Effect.fnUntraced(function* () {
				const held = yield* t
					.as(controllerAuthority)
					.act('jurisdiction_settings.update', [{ target: id, set: { sealed_at: NOW } }]);
				expect(held.kind, JSON.stringify(held)).toBe('pendingApproval');
				if (held.kind !== 'pendingApproval') throw new Error('The seal was not routed.');
				return held.requestId;
			});
			const move = (requestId: string, decision: 'approve' | 'reject' | 'requestChanges') =>
				approvals.decide({
					requestId,
					decision,
					authority,
					now: NOW,
					...(decision === 'approve' ? {} : { reason: 'Recheck the sources' })
				});
			// The seal is applied at once and held: nobody outside the request, an administrator included, may void it.
			const rejected = yield* seal();
			expect(yield* sealedAt()).toMatchObject({ sealed_at: NOW });
			expect(
				yield* Effect.flip(
					admin.act('jurisdiction_settings.update', [
						{
							target: id,
							set: { voided_at: NOW, void_reason: 'Around the review' }
						}
					])
				)
			).toMatchObject({ _tag: 'ActRefused', code: 'locked' });
			// A rejection rolls the seal back.
			expect(yield* move(rejected, 'reject')).toMatchObject({
				kind: 'decided',
				status: 'Rejected'
			});
			expect(yield* sealedAt()).toMatchObject({ sealed_at: null });
			// A request for change leaves the seal with the controller, who resubmits; approval keeps it.
			const requestId = yield* seal();
			expect(yield* move(requestId, 'requestChanges')).toMatchObject({
				status: 'ChangesRequested'
			});
			expect(yield* sealedAt()).toMatchObject({ sealed_at: NOW });
			const resubmitted = yield* t.as(controllerAuthority).act('jurisdiction_settings.update', [
				{
					target: id,
					set: { sealed_at: NOW }
				}
			]);
			expect(resubmitted).toMatchObject({ kind: 'pendingApproval', requestId });
			const decision = yield* move(requestId, 'approve');
			expect(decision, JSON.stringify(decision)).toMatchObject({
				kind: 'decided',
				status: 'Approved'
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
