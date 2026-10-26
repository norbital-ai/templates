<script lang="ts">
	import { bolt } from '$bolt';
	import { RecordShell, Show, type RecordView } from '@norbital-ai/ui';
	import RecordLink from '../../../lib/ui/record-link.svelte';
	import { Grid } from '@norbital-ai/ui/layout';
	import { isMasked } from '@norbital-ai/bolt';
	let {
		view
	}: {
		view: RecordView<'source_payments'>;
	} = $props();
	const fields = [
		{ name: 'reference', kind: { kind: 'text' } },
		{ name: 'kind', kind: { kind: 'enum', values: ['receipt', 'refund'] } },
		{ name: 'currency', kind: { kind: 'currency' } },
		{ name: 'amount', kind: { kind: 'money', currency: 'currency' } },
		{ name: 'settled_on', kind: { kind: 'date' } },
		{ name: 'active', kind: { kind: 'bool' } },
		{ name: 'source_updated_at', kind: { kind: 'instant' } }
	] as const;
</script>

{#snippet details(shown: RecordView<'source_payments'>)}
	{#if shown.mode !== 'create'}<Grid as="dl" gap="md">
			{#each ['order', 'invoice'] as const as relation}
				{@const value = shown.record[relation]}
				{#if value && !isMasked(value)}<div>
						<dt class="text-sm text-muted-foreground">
							{bolt.t(`models.source_payments.fields.${relation}`)}
						</dt>
						<dd>
							<RecordLink
								of={relation === 'order' ? 'orders' : 'transactions'}
								id={String(value)}
							/>
						</dd>
					</div>{/if}
			{/each}
			{#each fields as field (field.name)}<div>
					<dt class="text-sm text-muted-foreground">
						{bolt.t(`models.source_payments.fields.${field.name}`)}
					</dt>
					<dd>
						<Show
							kind={field.kind}
							value={shown.record[field.name]}
							row={shown.record}
							name={field.name}
						/>
					</dd>
				</div>{/each}
		</Grid>{/if}
{/snippet}
<RecordShell
	of="source_payments"
	mode={view.mode}
	{...view.mode !== 'create' ? { id: view.record.id } : { values: view.values }}
	children={details}
/>
