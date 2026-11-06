<script lang="ts">
	import {
		Button,
		Form,
		RecordShell,
		notifyOutcome,
		toast,
		type RecordView
	} from '@norbital-ai/ui';
	import { Cluster } from '@norbital-ai/ui/layout';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import { bolt } from '$bolt';
	let { view }: { view: RecordView<'workplace_case_catalog_entry'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const sealed = $derived(record?.payroll_run_id != null);
	/** A leave case waits for the HR controller: confirmed it opens its days, rejected it gives nothing. */
	const waiting = $derived(
		record !== null && record.inputs.employment_id != null && record.inputs.decision == null
	);
	const decide = (decision: 'CONFIRMED' | 'REJECTED') => {
		if (record === null) return;
		fork(
			bolt
				.act('workplace_case_catalog_entry.update', [
					{ target: record.id, set: { inputs: { ...record.inputs, decision } } }
				])
				.pipe(
					Effect.tap((outcome) => Effect.sync(() => notifyOutcome(bolt, outcome))),
					Effect.catch((error) =>
						Effect.sync(() =>
							toast.error(error instanceof Error ? error.message : bolt.t('component.error'))
						)
					)
				)
		);
	};
</script>

<RecordShell
	of="workplace_case_catalog_entry"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
	badge={sealed ? bolt.t('entry.included_in_payroll') : undefined}
>
	{#if waiting}<Cluster justify="end"
			><Button variant="outline" onclick={() => decide('REJECTED')}
				>{bolt.t('app.leave_case.reject')}</Button
			><Button onclick={() => decide('CONFIRMED')}>{bolt.t('app.leave_case.confirm')}</Button
			></Cluster
		>{/if}
	<Form
		of="workplace_case_catalog_entry"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
		fields={[
			'catalog_id',
			'entity_id',
			'kind',
			'opened_on',
			'scheduled_on',
			'closed_on',
			'inputs',
			'evidence_file'
		]}
	/>
</RecordShell>
