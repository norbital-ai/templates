<script lang="ts">
	import {
		Button,
		Field,
		Form,
		RecordShell,
		Sheet,
		notifyOutcome,
		type RecordView
	} from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { PlainDate } from '@norbital-ai/std/date';
	import { bolt } from '$bolt';
	import ReversalCancel from '../../../../../../../lib/ui/person/reversal_cancel.svelte';
	let { view }: { view: RecordView<'claim_catalog_entry'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	// the claim being reversed, held apart from the shown record, which reloads under the sheet once it files
	let reversing = $state<typeof record>(null);
	const clock = bolt.clock('day');
	// the HR controller reverses a claim; self-service only files its own
	const isHr =
		typeof window === 'undefined' || window.location.pathname.includes('/app/hr_controller/');
	const reversal = $derived(
		record === null
			? null
			: bolt.query({
					claim_catalog_entry: {
						where: { reverses: { eq: record.id } },
						fields: ['id'],
						limit: 1
					}
				})
	);
	// a forward claim a payroll run sealed, reversed once
	const canReverse = $derived(
		record !== null &&
			record.payroll_run_id != null &&
			record.reverses == null &&
			reversal?.current?.claim_catalog_entry.rows.length === 0
	);
	// a reversal no run has paid is cancelled by the ordinary delete
	const canCancel = $derived(
		record !== null &&
			record.reverses != null &&
			record.payroll_run_id == null &&
			view.mode !== 'create' &&
			view.capabilities?.delete.allowed === true
	);
</script>

{#snippet reverseAction()}
	<Button
		variant="outline"
		disabled={!canReverse}
		title={canReverse
			? undefined
			: 'Only a forward claim a payroll run sealed is reversed, once; an open claim is changed or deleted instead.'}
		onclick={() => (reversing = record)}
	>
		Reverse entry
	</Button>
{/snippet}

{#snippet cancelAction()}{#if record !== null}<ReversalCancel
			of="claim_catalog_entry"
			id={record.id}
		/>{/if}{/snippet}

<RecordShell
	of="claim_catalog_entry"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
	footerActions={record === null || !isHr
		? undefined
		: record.reverses == null
			? reverseAction
			: canCancel
				? cancelAction
				: undefined}
>
	<Form
		of="claim_catalog_entry"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	>
		{#snippet children()}<Stack gap="md">
				{#each record === null ? ['employment_id', 'catalog_id', 'quantity', 'incurred_on', 'evidence_file'] : ['quantity', 'incurred_on', 'evidence_file'] as name (name)}<Field
						{name}
					/>{/each}
			</Stack>{/snippet}
	</Form>
</RecordShell>

{#if reversing !== null}
	{@const original = reversing}
	<Sheet open onOpenChange={(open) => !open && (reversing = null)} title="Reverse claim">
		<Form
			of="claim_catalog_entry"
			mode="create"
			values={{
				entity_id: original.entity_id,
				employment_id: original.employment_id,
				catalog_id: original.catalog_id,
				incurred_on: PlainDate(clock.today),
				quantity: original.quantity,
				reverses: original.id
			}}
			submit="Reverse claim"
			onOutcome={(outcome) => {
				if (outcome.kind !== 'committed' && outcome.kind !== 'pendingApproval') return;
				notifyOutcome(bolt, outcome);
				reversing = null;
			}}
		>
			{#snippet children()}<Stack gap="md">
					<Field name="employment_id" readonly />
					<Field name="catalog_id" readonly />
					<p class="text-sm text-muted-foreground">
						How much of this claim to reverse, up to the {String(original.quantity)} it paid. It is dated
						today; the next run takes it back.
					</p>
					<Field name="quantity" />
				</Stack>{/snippet}
		</Form>
	</Sheet>
{/if}
