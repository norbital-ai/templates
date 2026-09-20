<script lang="ts">
	/**
	 * The life of a settings version, as the controller drives it: a new draft cloned from the
	 * version on screen, the draft sealed, a wrong seal voided.
	 *
	 * Sealing is one write of two rows: the predecessor's range ends where the draft begins, and
	 * the draft seals with its end at the next sealed version's start (open where there is none).
	 * One batch, because the collection reads the batch to see the predecessor ended — two writes
	 * would leave a shortened predecessor and an unsealed draft if the seal refused.
	 */
	import { Effect } from 'effect';
	import { toast } from 'svelte-sonner';
	import { getErrorMessage } from '@norbital-ai/std/error';
	import { Button } from '@norbital-ai/ui/button';
	import * as Dialog from '@norbital-ai/ui/dialog';
	import { Input } from '@norbital-ai/ui/input';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import { submitCollectionMutation } from '@norbital-ai/ui/collection-form';
	import Icon from '@iconify/svelte';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { client } from '../../lib/workspace-client.js';
	import { readRange } from '../../collections/payroll_runs/lib/effective.js';
	import { sealNeighbours, sealWrites } from '../../lib/settings_version_seal.js';
	import { todayKey } from '../../lib/ui/calendar.js';
	import { dateKey } from '../../lib/iso-day.js';

	type Version = WorkspaceRow<'jurisdiction_settings'>;
	let {
		version,
		lineage,
		onChosen
	}: {
		readonly version: Version;
		/** Every version of the lineage, newest first. */
		readonly lineage: readonly Version[];
		/** The page shows the version named, after a clone. */
		readonly onChosen: (versionId: string) => void;
	} = $props();
	const { t } = useI18n<TenantI18nKeys>();

	const sealed = $derived(version.sealed_at != null);
	const voided = $derived(version.voided_at != null);
	const start = $derived(readRange(version.effective_range)?.start ?? '');

	let newOpen = $state(false);
	let newName = $state('');
	let newStart = $state(todayKey());
	let sealOpen = $state(false);
	let voidOpen = $state(false);
	let voidReason = $state('');
	let busy = $state(false);

	const neighbours = $derived(sealNeighbours(version, lineage));

	const settle =
		(done: string) =>
		(outcome: Effect.Effect<unknown, unknown>): Effect.Effect<void> =>
			outcome.pipe(
				Effect.tap(() =>
					Effect.sync(() => {
						toast.success(done);
						busy = false;
						newOpen = sealOpen = voidOpen = false;
					})
				),
				Effect.catch((cause) =>
					Effect.sync(() => {
						toast.error(getErrorMessage(cause));
						busy = false;
					})
				)
			);

	/** The clone's input, from the dialog. */
	const cloneInput = () => ({
		settings_id: version.id,
		starts_on: newStart,
		...(newName.trim() === '' ? {} : { name: newName.trim() })
	});
	const chosen = (created: unknown): void => {
		toast.success(t('settings_version.cloned'));
		busy = false;
		newOpen = false;
		onChosen((created as { readonly id: string }).id);
	};
	const failed = (cause: unknown): void => {
		toast.error(getErrorMessage(cause));
		busy = false;
	};
</script>

<Inline gap="sm" justify="end">
	{#if !voided}
		<Button variant="outline" size="sm" disabled={busy} onclick={() => (newOpen = true)}>
			<Icon icon="lucide:git-branch-plus" class="size-4" />
			{t('settings_version.new')}
		</Button>
	{/if}
	{#if !sealed}
		<Button size="sm" disabled={busy} onclick={() => (sealOpen = true)}>
			<Icon icon="lucide:lock" class="size-4" />
			{t('settings_version.seal')}
		</Button>
	{:else if !voided}
		<Button variant="destructive" size="sm" disabled={busy} onclick={() => (voidOpen = true)}>
			<Icon icon="lucide:ban" class="size-4" />
			{t('settings_version.void')}
		</Button>
	{/if}
</Inline>

<Dialog.Root bind:open={newOpen}>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title
				>{t('settings_version.new_title', { name: String(version.name ?? '') })}</Dialog.Title
			>
			<Dialog.Description>{t('settings_version.new_description')}</Dialog.Description>
		</Dialog.Header>
		<Stack gap="md">
			<label class="text-sm">
				<span class="mb-1 block font-medium">{t('settings_version.starts_on')}</span>
				<Input
					type="date"
					value={newStart}
					oninput={(event) => (newStart = event.currentTarget.value)}
				/>
			</label>
			<label class="text-sm">
				<span class="mb-1 block font-medium">{t('component.name')}</span>
				<Input
					value={newName}
					oninput={(event) => (newName = event.currentTarget.value)}
					placeholder={`${version.code} from ${newStart}`}
				/>
			</label>
			<Inline justify="end" gap="sm">
				<Button variant="ghost" onclick={() => (newOpen = false)}>{t('component.cancel')}</Button>
				<Button
					disabled={busy || !/^\d{4}-\d{2}-\d{2}$/.test(newStart)}
					onclick={() => {
						busy = true;
						void Promise.resolve(client.invoke.new_settings_version(cloneInput())).then(
							chosen,
							failed
						);
					}}>{t('settings_version.new')}</Button
				>
			</Inline>
		</Stack>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={sealOpen}>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title
				>{t('settings_version.seal_title', { name: String(version.name ?? '') })}</Dialog.Title
			>
			<Dialog.Description>
				{neighbours.before == null
					? t('settings_version.seal_description_first', { start: dateKey(start) })
					: t('settings_version.seal_description', {
							start: dateKey(start),
							previous: String(neighbours.before.name ?? '')
						})}
			</Dialog.Description>
		</Dialog.Header>
		<Inline justify="end" gap="sm">
			<Button variant="ghost" onclick={() => (sealOpen = false)}>{t('component.cancel')}</Button>
			<Button
				disabled={busy}
				onclick={() => {
					busy = true;
					Effect.runFork(
						settle(t('settings_version.sealed'))(
							submitCollectionMutation(() =>
								client.collection.jurisdiction_settings.updateMany(
									sealWrites(version, lineage, new Date().toISOString())
								)
							)
						)
					);
				}}>{t('settings_version.seal')}</Button
			>
		</Inline>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={voidOpen}>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title
				>{t('settings_version.void_title', { name: String(version.name ?? '') })}</Dialog.Title
			>
			<Dialog.Description>{t('settings_version.void_description')}</Dialog.Description>
		</Dialog.Header>
		<Stack gap="md">
			<label class="text-sm">
				<span class="mb-1 block font-medium">{t('settings_version.void_reason')}</span>
				<Input value={voidReason} oninput={(event) => (voidReason = event.currentTarget.value)} />
			</label>
			<Inline justify="end" gap="sm">
				<Button variant="ghost" onclick={() => (voidOpen = false)}>{t('component.cancel')}</Button>
				<Button
					variant="destructive"
					disabled={busy}
					onclick={() => {
						busy = true;
						Effect.runFork(
							settle(t('settings_version.voided'))(
								submitCollectionMutation(() =>
									client.collection.jurisdiction_settings.update(version.id, {
										voided_at: new Date().toISOString(),
										void_reason: voidReason.trim()
									})
								)
							)
						);
					}}>{t('settings_version.void')}</Button
				>
			</Inline>
		</Stack>
	</Dialog.Content>
</Dialog.Root>
