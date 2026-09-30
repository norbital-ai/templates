import { collection, type Id } from '@norbital-ai/bolt';
import { factValueFault } from '../../../lib/datatypes/fact_keys.js';
import { dutyTypesOf, fulfilmentFault } from '../../../lib/obligations/materialise.js';

/**
 * The obligation ledger. Instances are raised by their triggers (`materialise`), never edited back open: an OPEN
 * instance is fulfilled with what its duty type declares, or waived with a reason, and a closed one is immutable.
 * Nothing deletes a raised duty; its trigger would raise it again.
 */
const c = collection('obligation_instances', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'company_id',
				'settings_id',
				'duty_code',
				'authority',
				'subject_kind',
				'subject_id',
				'trigger_ref',
				'triggered_on',
				'due_on',
				'amount_due',
				'retain_until',
				'state',
				'facts'
			]
		}
	},
	update: {
		input: {
			columns: ['amount_settled', 'state', 'fulfilled_on', 'waive_reason', 'reference', 'facts']
		}
	}
});
export default c;

type Row = {
	readonly id?: string;
	readonly settings_id?: string | null;
	readonly duty_code?: string | null;
	readonly subject_kind?: string | null;
	readonly state?: string | null;
	readonly fulfilled_on?: string | null;
	readonly waive_reason?: string | null;
	readonly facts?: Readonly<Record<string, unknown>> | null;
	readonly amount_due?: unknown;
	readonly amount_settled?: unknown;
};

c.transform(async (inputs, { existing, db, refuse }) => {
	const stored = existing as readonly (Row | undefined)[];
	const rows = inputs.map((input, index) => ({ ...stored[index], ...input }) as Row);
	const settingsIds = [
		...new Set(rows.flatMap((row) => (row.settings_id ? [row.settings_id] : [])))
	] as Id<'jurisdiction_settings'>[];
	const versions =
		settingsIds.length === 0
			? []
			: (
					await db.read('jurisdiction_settings', {
						where: { id: { in: settingsIds } },
						select: { id: true, duty_types: true },
						all: true
					})
				).rows;
	const fulfilling = rows.flatMap((row, index) =>
		row.state === 'FULFILLED' && stored[index]?.id != null ? [stored[index]!.id!] : []
	) as Id<'obligation_instances'>[];
	const evidence =
		fulfilling.length === 0
			? []
			: (
					await db.read('fact_evidence', {
						where: { subject: { obligation_instances: { in: fulfilling } } },
						select: { fact_key: true, subject: true },
						all: true
					})
				).rows;
	return inputs.map((input, index) => {
		const before = stored[index];
		const row = rows[index]!;
		if (before != null && before.state !== 'OPEN')
			return refuse(
				`${before.duty_code}: a ${String(before.state).toLowerCase()} duty is closed.`,
				{
					field: 'state'
				}
			);
		const duty = dutyTypesOf(versions.find((version) => version.id === row.settings_id)).find(
			(type) => type.code === row.duty_code
		);
		if (duty == null)
			return refuse(`The settings version declares no duty type ${row.duty_code}.`, {
				field: 'duty_code'
			});
		if (before == null) {
			if (row.subject_kind !== duty.subject)
				refuse(
					`${duty.code} is owed by a ${duty.subject.toLowerCase()}, not a ${String(row.subject_kind).toLowerCase()}.`,
					{
						field: 'subject_kind'
					}
				);
			if ((row.state ?? 'OPEN') !== 'OPEN')
				refuse(`${duty.code}: a duty is raised open.`, { field: 'state' });
		}
		for (const [key, value] of Object.entries(row.facts ?? {})) {
			const field = (duty.evidence ?? []).find((declared) => declared.key === key);
			if (field == null)
				refuse(`${duty.code} declares no completion fact ${key}.`, { field: 'facts' });
			const fault = factValueFault(field!, value);
			if (fault != null) refuse(`${duty.code}: ${fault}`, { field: 'facts' });
		}
		if (row.state === 'OPEN' && row.fulfilled_on != null)
			refuse(`${duty.code}: an open duty has no fulfilment day.`, { field: 'fulfilled_on' });
		if (row.state === 'WAIVED' && (row.waive_reason ?? '').trim() === '')
			refuse(`${duty.code}: a waiver states its reason.`, { field: 'waive_reason' });
		if (row.state === 'FULFILLED') {
			const evidenced = new Set(
				evidence.filter((e) => String(e.subject?.id) === before?.id).map((e) => e.fact_key)
			);
			const fault = fulfilmentFault(duty, row, evidenced);
			if (fault != null) refuse(fault, { field: 'state' });
		}
		return input;
	});
});
