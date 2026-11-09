<script lang="ts">
	import {
		Button,
		Field,
		Form,
		notifyOutcome,
		openRecord,
		RecordShell,
		Sheet,
		Textarea,
		toast,
		type RecordView
	} from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import { bolt } from '$bolt';

	let { view }: { view: RecordView<'entity_profile_version'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const t = bolt.t;
	let voiding = $state(false);
	let voidReason = $state('');
	let voidSaving = $state(false);
	let sealing = $state(false);

	const stateBadge = $derived(
		record === null
			? undefined
			: record.status === 'DRAFT'
				? t('contract.open')
				: record.status === 'VOID'
					? t('contract.voided')
					: undefined
	);
	const fields = [
		'entity_id',
		'name',
		'effective_range',
		'settings_code',
		'input_schema_version_id',
		'time_zone',
		'registered_address',
		'final_pay_loan_floor_percent',
		'overtime_full_award_percent',
		'entity_extension_data',
		'reason'
	] as const;

	function sealVersion() {
		if (record === null || sealing) return;
		sealing = true;
		fork(
			bolt
				.act('entity_profile_version.update', [{ target: record.id, set: { status: 'SEALED' } }])
				.pipe(
					Effect.tap((outcome) => Effect.sync(() => notifyOutcome(bolt, outcome))),
					Effect.tap((outcome) =>
						Effect.sync(() => {
							if (outcome.kind === 'committed') openRecord('entity_profile_version', record.id);
						})
					),
					Effect.catch((error) =>
						Effect.sync(() =>
							toast.error(error instanceof Error ? error.message : t('component.error'))
						)
					),
					Effect.ensuring(Effect.sync(() => (sealing = false)))
				)
		);
	}
	function beginVoid() {
		voidReason = '';
		voiding = true;
	}
	function voidVersion() {
		if (record === null || voidSaving || voidReason.trim() === '') return;
		const id = record.id;
		voidSaving = true;
		fork(
			bolt
				.act('entity_profile_version.update', [
					{ target: id, set: { status: 'VOID', reason: voidReason.trim() } }
				])
				.pipe(
					Effect.tap((outcome) => Effect.sync(() => notifyOutcome(bolt, outcome))),
					Effect.tap((outcome) =>
						Effect.sync(() => {
							if (outcome.kind !== 'committed') return;
							voiding = false;
							openRecord('entity_profile_version', id);
						})
					),
					Effect.catch((error) =>
						Effect.sync(() =>
							toast.error(error instanceof Error ? error.message : t('component.error'))
						)
					),
					Effect.ensuring(Effect.sync(() => (voidSaving = false)))
				)
		);
	}
</script>

{#snippet actions()}
	{#if record !== null}
		{#if record.status === 'DRAFT'}
			<Button disabled={sealing} onclick={sealVersion}>{t('employer_version.seal')}</Button>
		{:else if record.status === 'SEALED'}
			<Button variant="destructive" onclick={beginVoid}>{t('employer_version.void')}</Button>
		{/if}
	{/if}
{/snippet}

<RecordShell
	of="entity_profile_version"
	mode={view.mode}
	badge={stateBadge}
	lock={record !== null && record.status !== 'DRAFT' ? t('employer_version.read_only') : undefined}
	footerActions={actions}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#if record === null}
		<Form
			of="entity_profile_version"
			mode="create"
			values={view.mode === 'create' ? view.values : {}}
		>
			{#snippet children()}<Stack gap="md"
					>{#each fields as name (name)}<Field {name} />{/each}</Stack
				>{/snippet}
		</Form>
	{:else}
		<Form of="entity_profile_version" mode="update" id={record.id} {record} {fields} />
	{/if}
</RecordShell>

{#if record !== null}
	<Sheet bind:open={voiding} title={t('employer_version.void_title')}>
		<Stack gap="md">
			<p class="text-muted-foreground text-sm">{t('employer_version.void_help')}</p>
			<label class="grid gap-1" for="entity-version-void-reason">
				<span class="text-xs font-medium text-muted-foreground">{t('settings_version.reason')}</span
				>
				<Textarea id="entity-version-void-reason" bind:value={voidReason} disabled={voidSaving} />
			</label>
			<Cluster gap="sm" justify="end">
				<Button variant="outline" disabled={voidSaving} onclick={() => (voiding = false)}
					>{t('component.cancel')}</Button
				>
				<Button
					variant="destructive"
					disabled={voidSaving || voidReason.trim() === ''}
					onclick={voidVersion}>{t('employer_version.void')}</Button
				>
			</Cluster>
		</Stack>
	</Sheet>
{/if}
