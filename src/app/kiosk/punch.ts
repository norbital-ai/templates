import type { Id } from '@norbital-ai/bolt';
import { bolt } from '$bolt';

/** What `work_days.kiosk_punch` answers: the half of the day it wrote, or why nothing was written. */
export type PunchResult = {
	readonly status: 'in' | 'out' | 'blocked';
	readonly kind: 'FACE' | 'MANUAL';
	readonly intervalIndex?: number;
	readonly time?: string;
	readonly cooldownMs?: number;
	readonly reason?: string;
	readonly retryAfterMs?: number;
	readonly plannedCode?: string;
};

/** One punch through the `work_days` action; a refusal or conflict rejects with the server's sentence. */
export async function punchWork(
	employment_id: Id<'employments'>,
	kind: 'FACE' | 'MANUAL'
): Promise<PunchResult> {
	const outcome = await bolt.act('work_days.kiosk_punch', { employment_id, kind });
	if (outcome.kind === 'committed') return outcome.output as PunchResult;
	throw new Error(
		outcome.kind === 'refused' ? outcome.message : `The punch was not recorded (${outcome.kind}).`
	);
}
