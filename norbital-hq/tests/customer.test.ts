import { workspace, recordAt, recordOf, pageOf, targetOf } from './workspace.js';
import { Effect } from 'effect';
import type { Id } from '@norbital-ai/bolt';
/** Customer activity, issues and files follow their project's customer through every write. */
import { expect, it } from '@effect/vitest';
it.live('activities infers its customer and follows project changes', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const admin = yield* t.as(t.admin);
		const customers: Id<'companies'>[] = [];
		const projects: Id<'projects'>[] = [];
		for (const name of ['North customer', 'South customer']) {
			const customer = yield* admin.act({ 'companies.create': [{ name }] });
			if (customer.kind !== 'committed') throw new Error(JSON.stringify(customer));
			customers.push(recordOf(customer.records, 'companies', 0).id);
			const project = yield* admin.act({
				'projects.create': [
					{
						name,
						company_id: recordOf(customer.records, 'companies', 0).id
					}
				]
			});
			if (project.kind !== 'committed') throw new Error(JSON.stringify(project));
			projects.push(recordOf(project.records, 'projects', 0).id);
		}
		const created = yield* admin.act({
			'activities.create': [
				{
					subject: 'Customer call',
					project_id: recordAt(projects, 0)
				}
			]
		});
		if (created.kind !== 'committed') throw new Error(JSON.stringify(created));
		const id = recordOf(created.records, 'activities', 0).id;
		expect(
			pageOf(
				yield* admin.query({ activities: { where: { id: { eq: id } }, limit: 1 } }),
				'activities'
			).rows[0] ?? null
		).toMatchObject({ company: customers[0] });
		expect(
			(yield* admin.act({
				'activities.update': [
					{
						target: yield* targetOf(t, 'activities', id),
						set: { project_id: recordAt(projects, 1), company: recordAt(customers, 0) }
					}
				]
			})).kind
		).toBe('committed');
		expect(
			pageOf(
				yield* admin.query({ activities: { where: { id: { eq: id } }, limit: 1 } }),
				'activities'
			).rows[0] ?? null
		).toMatchObject({ company: customers[1] });
		expect(
			(yield* admin.act({
				'activities.update': [
					{
						target: yield* targetOf(t, 'activities', id),
						set: { project_id: null, company: recordAt(customers, 0) }
					}
				]
			})).kind
		).toBe('committed');
		expect(
			pageOf(
				yield* admin.query({ activities: { where: { id: { eq: id } }, limit: 1 } }),
				'activities'
			).rows[0] ?? null
		).toMatchObject({
			company: customers[0],
			project_id: null
		});
	}).pipe(Effect.scoped)
);
