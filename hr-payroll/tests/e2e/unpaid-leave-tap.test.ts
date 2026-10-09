/**
 * An unpaid-leave request runs the behaviour taps to success in every sample entity's lineage: an entry with no facts
 * and a class with no entitlement is an ordinary trigger row. Skipped when the build carries no sample pack.
 */
import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { company, recorded } from '../host_reads.ts';

const sample = existsSync(`${process.cwd()}/.norbital/seed/sample/pack.json`);
const ENTITIES = [
	'0cc7cdd4-848b-598e-8e4c-b8769c97f12b',
	'e7b313fc-e947-5b78-8066-97bea6644915',
	'c09a2dc4-94bd-5d1c-adb7-e46a4f7cbe3f',
	'5032dab9-8010-538a-ac4c-ce2219b84767'
];
const DAY = '2026-10-14';

it.skipIf(!sample).each(ENTITIES)(
	'an unpaid-leave entry runs the taps without a failure (%s)',
	{ timeout: 600_000 },
	async (entity) => {
		const { t } = await recorded({ now: '2026-10-08T04:00:00.000Z', pack: company(entity, 5) });
		await t.runDue();
		const [found] = (
			await t.db.read([
				{
					text: `SELECT k.id AS employment_id, c.id AS catalog_id FROM employment_contract k
						JOIN entity e ON e.id = k.company_id
						JOIN jurisdiction_settings s ON s.code = e.settings_code
							AND lower(s.effective_range) <= DATE '2026-10-14'
							AND (upper(s.effective_range) IS NULL OR upper(s.effective_range) > DATE '2026-10-14')
						JOIN leave_catalog c ON c.settings_id = s.id AND c.code = 'UNPAID_LEAVE'
						WHERE k.company_id = $1 AND k.approval_id IS NULL AND lower(k.effective_range) <= DATE '2026-10-14'
							AND (upper(k.effective_range) IS NULL OR upper(k.effective_range) > DATE '2026-10-14')
						LIMIT 1`,
					params: [entity]
				}
			])
		)[0]!.rows;
		expect(found, entity).toBeDefined();
		const hr = t.as(t.member(['hr_manager']));
		const entry = await hr.act('leave_catalog_entry.create', {
			employment_id: found!['employment_id'],
			catalog_id: found!['catalog_id'],
			occurred_on: DAY,
			activity: 'TIME_OFF',
			from: DAY,
			to: DAY
		} as never);
		expect(entry.kind, JSON.stringify(entry)).not.toBe('refused');
		await t.runDue();
		// a second day on the same request: the update arm
		const created = entry.kind === 'committed' ? entry.records[0]?.id : undefined;
		if (created != null)
			expect(
				(
					await hr.act('leave_catalog_entry.update', {
						target: created,
						set: { to: '2026-10-15' }
					} as never)
				).kind
			).not.toBe('refused');
		await t.runDue();
		const failed = (
			await t.db.read([
				{
					text: `SELECT error::text AS error FROM sys_run WHERE automation = 'behaviour_taps' AND state = 'failed'`,
					params: []
				}
			])
		)[0]!.rows;
		expect(failed, JSON.stringify(failed)).toEqual([]);
	}
);
