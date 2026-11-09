<script lang="ts">
	import { Button, Form, RecordShell, Sheet, Table, type RecordView } from '@norbital-ai/ui';
	import SealedBadge from '../../../../../../../lib/ui/payroll/sealed_badge.svelte';
	import LeaveEntryForm from '../../../../../../../lib/ui/person/leave_entry_form.svelte';
	import { Stack } from '@norbital-ai/ui/layout';
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { untrack } from 'svelte';

	let { view }: { view: RecordView<'leave_catalog_entry'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	type Slot = {
		readonly id: Id<'leave_catalog_entry_day'>;
		readonly incurred_on: string;
		readonly part: string;
		readonly payroll_run_id: Id<'payroll_run'> | null;
	};
	let slots = $state<readonly Slot[]>([]);
	let reversing = $state(false);
	const captured = $derived(slots.filter((slot) => slot.payroll_run_id != null));
	const isHr =
		typeof window === 'undefined' || window.location.pathname.includes('/app/hr_controller/');
	const canReverse = $derived(record !== null && record.reverses == null && captured.length > 0);
	$effect(() => {
		const id = record?.id ?? null;
		if (id === null) {
			slots = [];
			return;
		}
		untrack(() => {
			void (async () => {
				const answer = await bolt.query({
					leave_catalog_entry_day: {
						where: { leave_entry_id: { eq: id } },
						fields: ['id', 'incurred_on', 'part', 'payroll_run_id'],
						orderBy: { incurred_on: 'asc' },
						limit: 10000
					}
				});
				slots = answer.leave_catalog_entry_day.rows.map((row) => ({
					id: row.id,
					incurred_on: String(row.incurred_on),
					part: String(row.part),
					payroll_run_id: row.payroll_run_id ?? null
				}));
			})();
		});
	});
</script>

{#snippet sealCell({ value }: { value: unknown })}<SealedBadge sealed={value != null} />{/snippet}

{#snippet reverseAction()}
	<Button
		variant="outline"
		disabled={!canReverse || !isHr}
		title={!isHr
			? 'A reversal is created by the HR Controller.'
			: !canReverse
				? 'Only a day a payroll run has captured can be reversed; an unpriced day is deleted instead.'
				: undefined}
		onclick={() => (reversing = true)}
	>
		Reverse entry
	</Button>
{/snippet}

<RecordShell
	of="leave_catalog_entry"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
	footerActions={record === null ? undefined : reverseAction}
>
	{#if record === null}
		<Form
			of="leave_catalog_entry"
			mode="create"
			values={view.mode === 'create' ? view.values : {}}
			fields={['employment_id', 'catalog_id', 'evidence_file']}
		/>
	{:else}
		<Stack gap="md">
			<Form
				of="leave_catalog_entry"
				mode="update"
				id={record.id}
				{record}
				fields={['employment_id', 'catalog_id', 'reverses', 'evidence_file']}
			/>
			<section class="grid gap-2" data-leave-slots>
				<h3 class="text-sm font-medium">Leave days</h3>
				<div class="overflow-hidden rounded-md border">
					<Table
						of={slots}
						key="leave-entry-slots"
						layout="grid"
						columns={[
							'incurred_on',
							'part',
							{ field: 'payroll_run_id', label: 'Payroll run', cell: sealCell }
						]}
					/>
				</div>
			</section>
		</Stack>
	{/if}
</RecordShell>

{#if reversing && record !== null}
	<Sheet open onOpenChange={(open) => !open && (reversing = false)} title="Reverse leave">
		<LeaveEntryForm
			allowReversal
			entityId={record.entity_id}
			employmentId={record.employment_id}
			catalogId={record.catalog_id}
			reverses={record.id}
			onDone={() => (reversing = false)}
		/>
	</Sheet>
{/if}
