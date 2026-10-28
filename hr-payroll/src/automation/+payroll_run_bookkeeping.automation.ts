import { automation } from '@norbital-ai/bolt';

/** The models a run pins (`payroll_run.pins[].collection`), each with the verb that writes its `payslip_id`. */
const PIN_UPDATE = {
	adhoc_catalog_entry: 'adhoc_catalog_entry.update',
	claim_catalog_entry: 'claim_catalog_entry.update',
	leave_catalog_entry: 'leave_catalog_entry.update',
	loan_repayment_entry: 'loan_repayment_entry.update',
	roster_entry: 'roster_entry.update'
} as const;
const isPinned = (collection: string): collection is keyof typeof PIN_UPDATE =>
	Object.hasOwn(PIN_UPDATE, collection);
/**
 * A run's bookkeeping, the same under every jurisdiction. A created run pins each entry it settled to its employment's
 * slip of the run (`payslip_id`). A deleted run withdraws the duties it raised: its open, unsettled obligations are
 * deleted, and its open tasks dismissed with their occurrence key moved, so the duty is raised anew. The withdrawal's
 * day is the run's settlement start, as the behaviour taps date a run.
 */
export default automation('payroll_run_bookkeeping', {
	description:
		'Pins the entries a created payroll run settled to its payslips, and withdraws the open obligations and tasks a deleted run raised.',
	on: [{ created: 'payroll_run' }, { deleted: 'payroll_run' }],
	runAs: ['hr_controller'],
	concurrency: { max: 1 },
	run: function* (input, ctx) {
		if (ctx.cause === 'created') {
			const { payroll_run, payslip } = yield* ctx.query({
				payroll_run: { where: { id: { in: input.ids } }, fields: ['pins'] },
				payslip: {
					where: { payroll_run_id: { in: input.ids } },
					fields: ['payroll_run_id', 'employment_id']
				}
			});
			const pins = new Map<
				keyof typeof PIN_UPDATE,
				{ readonly target: string; readonly set: { readonly payslip_id: string } }[]
			>();
			for (const run of payroll_run.rows)
				for (const pin of run.pins ?? []) {
					const slip = payslip.rows.find(
						(row) => row.payroll_run_id === run.id && row.employment_id === pin.employment_id
					);
					if (slip === undefined || !isPinned(pin.collection)) continue;
					const held = pins.get(pin.collection) ?? [];
					held.push({ target: pin.id, set: { payslip_id: slip.id } });
					pins.set(pin.collection, held);
				}
			if (pins.size > 0)
				yield* ctx.act.checked(
					[...pins].map(([collection, rows]) => ({ callable: PIN_UPDATE[collection], input: rows }))
				);
			return;
		}
		const runs = input.rows ?? [];
		if (runs.length === 0) return;
		const days = new Map<string, string>(
			runs.map((run) => [
				run.id,
				run.salary_from == null
					? `${String(run.period).slice(0, 7)}-01`
					: String(run.salary_from).slice(0, 10)
			])
		);
		const ids = runs.map((run) => run.id);
		const { obligation, regulatory_task } = yield* ctx.query({
			obligation: {
				where: { trigger_ref: { in: ids }, state: { eq: 'OPEN' }, amount_settled: { isNull: true } },
				fields: ['trigger_ref']
			},
			regulatory_task: {
				where: { subject_id: { in: ids }, state: { eq: 'OPEN' } },
				fields: ['subject_id', 'occurrence_key']
			}
		});
		const acts = [
			...(obligation.rows.length === 0
				? []
				: [
						{
							callable: 'obligation.delete' as const,
							input: obligation.rows.map((row) => ({ target: row.id }))
						}
					]),
			...(regulatory_task.rows.length === 0
				? []
				: [
						{
							callable: 'regulatory_task.update' as const,
							input: regulatory_task.rows.map((row) => {
								const day = days.get(row.subject_id) ?? '';
								return {
									target: row.id,
									set: {
										state: 'DISMISSED',
										dismiss_reason: `The payroll run that raised it was deleted on ${day}.`,
										occurrence_key: `${row.occurrence_key}:withdrawn:${day}`
									}
								};
							})
						}
					])
		];
		if (acts.length > 0) yield* ctx.act.checked(acts);
	}
});
