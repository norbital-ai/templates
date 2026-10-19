/**
 * An unpaid-leave request runs the behaviour taps to success in every sample entity's lineage: an entry with no facts
 * and a class with no entitlement is an ordinary trigger row. Skipped when the build carries no sample pack.
 */
import { existsSync } from 'node:fs';
import { expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { company, recorded } from '../host_reads.ts';
import { nativeId } from '../fixture_values.ts';

const sample = existsSync(`${process.cwd()}/.norbital/seed/sample/pack.json`);
const ENTITIES = [
	'0cc7cdd4-848b-598e-8e4c-b8769c97f12b',
	'e7b313fc-e947-5b78-8066-97bea6644915',
	'c09a2dc4-94bd-5d1c-adb7-e46a4f7cbe3f',
	'5032dab9-8010-538a-ac4c-ce2219b84767'
];
const DAY = '2026-10-14';

for (const entity of ENTITIES)
	it.live.skipIf(!sample)(
		`an unpaid-leave entry runs the taps without a failure (${entity})`,
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				yield* t.runDue();
				const [found] = yield* t.db.rows(
					Schema.Struct({ employment_id: Schema.String, catalog_id: Schema.String }),
					{
						text: `SELECT k.id AS employment_id, c.id AS catalog_id FROM employment_contract k
						JOIN entity e ON e.id = k.company_id
						JOIN jurisdiction_settings s ON s.code = e.settings_code
							AND lower(s.effective_range) <= DATE '2026-10-14'
							AND (upper(s.effective_range) IS NULL OR upper(s.effective_range) > DATE '2026-10-14')
						JOIN leave_catalog c ON c.settings_id = s.id AND c.code = 'UNPAID_LEAVE'
						WHERE k.company_id = $1 AND lower(k.effective_range) <= DATE '2026-10-14'
							AND (upper(k.effective_range) IS NULL OR upper(k.effective_range) > DATE '2026-10-14')
						LIMIT 1`,
						params: [entity]
					}
				);
				expect(found, entity).toBeDefined();
				if (found === undefined) throw new Error(`No unpaid-leave catalogue for ${entity}.`);
				const hr = t.as(t.member(['hr_manager']));
				const entry = yield* hr.act('leave_catalog_entry.create', {
					employment_id: nativeId('employment_contract', found['employment_id']),
					catalog_id: nativeId('leave_catalog', found['catalog_id']),
					occurred_on: DAY,
					activity: 'TIME_OFF',
					from: DAY,
					to: DAY
				});
				expect(entry.kind, JSON.stringify(entry)).not.toBe('refused');
				yield* t.runDue();
				// a second day on the same request: the update arm
				const created = entry.kind === 'committed' ? entry.records[0]?.id : undefined;
				if (created != null)
					expect(
						(yield* hr.act('leave_catalog_entry.update', {
							target: nativeId('leave_catalog_entry', created),
							set: { to: '2026-10-15' }
						})).kind
					).not.toBe('refused');
				yield* t.runDue();
				const failed = yield* t.db.rows(Schema.Struct({ error: Schema.NullOr(Schema.String) }), {
					text: `SELECT error::text AS error FROM sys_run WHERE automation = 'behaviour_taps' AND state = 'failed'`,
					params: []
				});
				expect(failed, JSON.stringify(failed)).toEqual([]);
			}).pipe(
				Effect.provide(recorded({ now: '2026-10-08T04:00:00.000Z', pack: company(entity, 5) })),
				Effect.scoped
			),
		{ timeout: 600_000 }
	);
