import { expect, layer } from '@effect/vitest';
import type { Json } from '@norbital-ai/bolt/engine';
import { TestWorkspace, JobResult } from '@norbital-ai/bolt-cli/test';
import {
	sharedWorkspace,
	required,
	recordOf,
	runRows,
	pageOf,
	targetOf,
	ofKind
} from './workspace.js';
import { Effect, Schema } from 'effect';

import { answeringModel, extraction } from './model.js';
import { SOW_FIELDS } from '../src/lib/extracted.js';

/** A job's implementation scope, decoded by its own field's kind from the kit's manifest-typed row. */
const scopeOf = (row: { readonly [field: string]: unknown }) =>
	Schema.decodeUnknownSync(ofKind(SOW_FIELDS.implementation_scope))(row['implementation_scope']);

/** Each extraction test sets the model's answer. */
let answer: (prompt: string) => Json | null = () => null;
const model = answeringModel((prompt) => answer(prompt));
layer(sharedWorkspace({ ports: model.ports }), { excludeTestServices: true })(
	'customers and jobs',
	(it) => {
		it.effect(
			'extracts the scope of work only from the affected job’s activities, citing them, and leaves its SOW alone',
			() =>
				Effect.gen(function* () {
					let activityId = '';
					answer = (prompt) =>
						extraction({
							scope: {
								overview: 'Delivery tracking for Example.',
								definitions: [{ term: 'POD', meaning: 'Proof of delivery', sources: [activityId] }],
								implementation_scope: [
									{
										feature: 'Delivery confirmation',
										included: ['Capture POD photos'],
										dependencies: ['Drivers use the app'],
										sources: [activityId, 'invented-source']
									}
								],
								data_migration: []
							},
							plan: {
								milestones: [
									{ timeline: 'Weeks 0–4', milestone: 'Weekly prototypes', sources: [activityId] }
								],
								uat_tests: [
									{
										ref: 'FT-01',
										name: 'POD capture',
										objective: 'Verify capture',
										expected_result: 'Every delivery has a POD',
										sources: [activityId]
									}
								],
								fees: [],
								decisions: []
							}
						})(prompt);
					const t = yield* TestWorkspace;
					const admin = yield* t.as(t.admin);
					const customer = yield* admin.act({ 'companies.create': [{ name: 'Example' }] });
					if (customer.kind !== 'committed') throw new Error(JSON.stringify(customer));
					const company = recordOf(customer.records, 'companies', 0).id;
					const jobs = yield* admin.act({
						'projects.create': [
							{ name: 'Job A', company_id: company },
							{ name: 'Job B', company_id: company }
						]
					});
					if (jobs.kind !== 'committed') throw new Error(JSON.stringify(jobs));
					const project = recordOf(jobs.records, 'projects', 0).id;
					const other = recordOf(jobs.records, 'projects', 1).id;
					yield* admin.act({
						'activities.create': [
							{
								kind: 'note',
								subject: 'Other job secret',
								project_id: other,
								detail: 'Unrelated job.'
							}
						]
					});
					const activity = yield* admin.act({
						'activities.create': [
							{
								kind: 'call',
								subject: 'Delivery discovery call',
								project_id: project,
								detail: 'Delivery confirmations are manual; they want POD photos.'
							}
						]
					});
					if (activity.kind !== 'committed') throw new Error(JSON.stringify(activity));
					activityId = recordOf(activity.records, 'activities', 0).id;
					yield* t.run_due();
					const runs = yield* runRows(t, 'update_requirements');
					expect(runs.length).toBeGreaterThan(0);
					expect(runs.every((row) => row.state === 'succeeded' && row.error === null)).toBe(true);
					const job = required(
						pageOf(
							yield* admin.query({
								projects: { where: { id: { eq: project } }, limit: 1 }
							}),
							'projects'
						).rows[0] ?? null
					);
					expect(job).toMatchObject({
						overview: 'Delivery tracking for Example.',
						generation_error: null,
						implementation_scope: [
							{
								feature: 'Delivery confirmation',
								included: ['Capture POD photos'],
								origin: 'generated',
								sources: [activityId]
							}
						],
						uat_tests: [{ ref: 'FT-01', origin: 'generated', sources: [activityId] }],
						milestones: [{ timeline: 'Weeks 0–4', origin: 'generated' }],
						fees: null
					});
					// the customer's profile reads all its jobs; the job's own extractions read only that job
					const scopePrompts = model.prompts.filter(
						(prompt) => prompt.includes(activityId) && !prompt.includes('business nature')
					);
					expect(scopePrompts.length).toBeGreaterThanOrEqual(2);
					expect(scopePrompts.every((prompt) => !prompt.includes('Other job secret'))).toBe(true);
					expect(model.prompts.some((prompt) => prompt.includes('Other job secret'))).toBe(true);
				})
		);

		it.effect('keeps what a person edited when the scope is extracted again', () =>
			Effect.gen(function* () {
				let overview = 'First extraction';
				answer = (prompt) =>
					extraction({
						scope: {
							overview,
							definitions: [],
							implementation_scope: [
								{ feature: 'Reporting', included: ['Weekly report'], sources: [] },
								{ feature: 'Alerts', included: ['SMS alerts'], sources: [] }
							],
							data_migration: []
						}
					})(prompt);
				const t = yield* TestWorkspace;
				const admin = yield* t.as(t.admin);
				const customer = yield* admin.act({ 'companies.create': [{ name: 'Edited example' }] });
				if (customer.kind !== 'committed') throw new Error(JSON.stringify(customer));
				const job = yield* admin.act({
					'projects.create': [
						{
							name: 'Job',
							company_id: recordOf(customer.records, 'companies', 0).id
						}
					]
				});
				if (job.kind !== 'committed') throw new Error(JSON.stringify(job));
				const project = recordOf(job.records, 'projects', 0).id;
				yield* admin.act({
					'activities.create': [{ kind: 'note', subject: 'Scope', project_id: project }]
				});
				yield* t.run_due();
				const first = required(
					pageOf(
						yield* admin.query({ projects: { where: { id: { eq: project } }, limit: 1 } }),
						'projects'
					).rows[0] ?? null
				);
				expect(scopeOf(first)?.map((item) => item.origin)).toEqual(['generated', 'generated']);
				// a person rewrites one requirement and adds their own milestone
				const [reporting, alerts] = required(scopeOf(first));
				expect(
					(yield* admin.act({
						'projects.update': [
							{
								target: yield* targetOf(t, 'projects', project),
								set: {
									implementation_scope: [
										required(reporting),
										{ ...required(alerts), included: ['SMS and email alerts'] }
									],
									milestones: [{ timeline: 'Week 8', milestone: 'Handover' }],
									overview: 'Written by the owner'
								}
							}
						]
					})).kind
				).toBe('committed');
				const edited = required(
					pageOf(
						yield* admin.query({ projects: { where: { id: { eq: project } }, limit: 1 } }),
						'projects'
					).rows[0] ?? null
				);
				expect(scopeOf(edited)?.map((item) => item.origin)).toEqual(['generated', 'manual']);
				expect(edited.milestones).toMatchObject([{ timeline: 'Week 8', origin: 'manual' }]);
				expect(edited.manual_fields).toEqual(['overview']);
				overview = 'Second extraction';
				yield* admin.run('update_requirements', { project }, JobResult);
				yield* t.run_due();
				const again = required(
					pageOf(
						yield* admin.query({ projects: { where: { id: { eq: project } }, limit: 1 } }),
						'projects'
					).rows[0] ?? null
				);
				expect(again.overview).toBe('Written by the owner');
				expect(again.implementation_scope).toMatchObject([
					{ feature: 'Reporting', origin: 'generated' },
					{ feature: 'Alerts', included: ['SMS and email alerts'], origin: 'manual' }
				]);
				expect(again.milestones).toMatchObject([{ timeline: 'Week 8', origin: 'manual' }]);
				// clearing the overview hands it back to extraction
				yield* admin.act({
					'projects.update': [
						{ target: yield* targetOf(t, 'projects', project), set: { overview: null } }
					]
				});
				yield* admin.run('update_requirements', { project }, JobResult);
				yield* t.run_due();
				expect(
					(
						pageOf(
							yield* admin.query({ projects: { where: { id: { eq: project } }, limit: 1 } }),
							'projects'
						).rows[0] ?? null
					)?.overview
				).toBe('Second extraction');
			})
		);
	}
);
