/**
 * The entity's pay schedule is history, through a real entity write: a switch after the last paid day commits; one
 * on or before it, a changed starting frequency, or a switch to a frequency whose periods straddle months is refused
 * by the entity transform. Skipped when the build carries no sample pack.
 */
import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { company, recorded } from '../host_reads.ts';

const sample = existsSync(`${process.cwd()}/.norbital/seed/sample/pack.json`);
const MY = 'e7b313fc-e947-5b78-8066-97bea6644915';

it.skipIf(!sample)(
	'a pay frequency switch never rewrites a paid period',
	{ timeout: 600_000 },
	async () => {
		const { t } = await recorded({ now: '2026-02-10T04:00:00.000Z', pack: company(MY, 1) });
		await t.runDue();
		const hr = t.as(t.admin);
		const reschedule = (set: Record<string, unknown>) =>
			hr.act('entity.update', { target: MY, set } as never);
		const outcome = (value: unknown) => {
			if (value instanceof Error) return `refused: ${value.message}`;
			const held = value as { kind: string; message?: string };
			return held.kind === 'refused' ? `refused: ${String(held.message)}` : held.kind;
		};
		const january = await hr.act('payroll_run.create', {
			company_id: MY,
			period: '2026-01',
			kind: 'REGULAR'
		});
		expect(january.kind, JSON.stringify(january)).toBe('committed');
		// January is paid through the 31st: a switch inside it, or a new starting frequency, is refused
		expect(
			outcome(
				await reschedule({
					pay_frequency_changes: [{ from: '2026-01-16', frequency: 'SEMI_MONTHLY' }]
				}).catch((cause: unknown) => cause)
			)
		).toMatch(/refused: .*2026-01-31/);
		expect(
			outcome(await reschedule({ pay_frequency: 'SEMI_MONTHLY' }).catch((cause: unknown) => cause))
		).toMatch(/refused: .*record a switch/);
		expect(
			outcome(
				await reschedule({
					pay_frequency_changes: [{ from: '2026-02-01', frequency: 'WEEKLY' }]
				}).catch((cause: unknown) => cause)
			)
		).toMatch(/refused: .*straddle/);
		// a switch after it commits, and February's first half is then a period
		expect(
			outcome(
				await reschedule({
					pay_frequency_changes: [{ from: '2026-02-01', frequency: 'SEMI_MONTHLY' }]
				})
			)
		).toBe('committed');
		const half = await hr.act('payroll_run.create', {
			company_id: MY,
			period: '2026-02-1',
			kind: 'REGULAR'
		});
		expect(half.kind, JSON.stringify(half)).toBe('committed');
	}
);
