<script lang="ts" module>
	/** The settings page's version picker: a clone switches the page to the new draft (absent elsewhere). */
	export const CHOOSE_SETTINGS_VERSION = Symbol('hr.settings.choose-version');
</script>

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
	import { t } from '../i18n/t.js';
	import { bolt } from '$bolt';
	import Icon from '@iconify/svelte';
	import { toast } from 'svelte-sonner';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import type { ActInput, Callable, DatePeriod, Id } from '@norbital-ai/bolt';
	import { Button, DateInput, Dialog, Input } from '@norbital-ai/ui';
	import { sealNeighbours, sealWrites } from '../settings_version_seal.js';
	import { Instant, PlainDate } from '@norbital-ai/std/date';
	import { todayKey } from '../format/calendar.js';

	type Version = {
		readonly id: Id<'jurisdiction_settings'>;
		readonly code: string;
		readonly name: string;
		readonly effective_range: DatePeriod;
		readonly sealed_at: string | null;
		readonly voided_at: string | null;
	};
	let {
		version,
		lineage,
		onChosen
	}: {
		readonly version: Version;
		/** Every version of the lineage, newest first. */
		readonly lineage: readonly Version[];
		/** The page shows the version named, after a clone. */
		readonly onChosen?: (versionId: Id<'jurisdiction_settings'>) => void;
	} = $props();

	const sealed = $derived(version.sealed_at != null);
	const voided = $derived(version.voided_at != null);
	const start = $derived(version.effective_range.from);

	let newOpen = $state(false);
	let newName = $state('');
	let newStart = $state<string | null>(todayKey());
	let sealOpen = $state(false);
	let voidOpen = $state(false);
	let voidReason = $state('');
	let busy = $state(false);

	const neighbours = $derived(sealNeighbours(version, lineage));

	/** One act of the lifecycle: a refusal is the toast, a success closes the dialogs. */
	async function run<const N extends string>(
		callable: N extends Callable ? N : Callable,
		input: ActInput<N>,
		done: string
	) {
		busy = true;
		const outcome = await bolt.act<N>(callable, input);
		busy = false;
		if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') {
			toast.success(done);
			newOpen = sealOpen = voidOpen = false;
		} else toast.error(outcome.kind === 'refused' ? outcome.message : t('component.error'));
		return outcome;
	}
</script>

<!--
	The controls are the version record's own actions (its RecordShell header). The dialogs stay
	here and portal from wherever this component is mounted.
-->
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
				<DateInput value={newStart} onChange={(next) => (newStart = next)} />
			</label>
			<label class="text-sm">
				<span class="mb-1 block font-medium">{t('component.name')}</span>
				<Input
					value={newName}
					oninput={(event) => (newName = event.currentTarget.value)}
					placeholder={t('settings_version.name_placeholder', {
						code: version.code,
						date: newStart ?? ''
					})}
				/>
			</label>
			<Inline justify="end" gap="sm">
				<Button variant="ghost" onclick={() => (newOpen = false)}>{t('component.cancel')}</Button>
				<Button
					disabled={busy || newStart == null}
					onclick={async () => {
						if (newStart == null) return;
						const outcome = await run(
							'jurisdiction_settings.new_settings_version',
							{
								settings_id: version.id,
								starts_on: PlainDate(newStart),
								...(newName.trim() === '' ? {} : { name: newName.trim() })
							},
							t('settings_version.cloned')
						);
						if (outcome.kind === 'committed') onChosen?.(outcome.output);
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
					? t('settings_version.seal_description_first', { start })
					: t('settings_version.seal_description', {
							start,
							previous: String(neighbours.before.name ?? '')
						})}
			</Dialog.Description>
		</Dialog.Header>
		<Inline justify="end" gap="sm">
			<Button variant="ghost" onclick={() => (sealOpen = false)}>{t('component.cancel')}</Button>
			<Button
				disabled={busy}
				onclick={() =>
					run(
						'jurisdiction_settings.update',
						sealWrites(version, lineage, Instant(new Date())),
						t('settings_version.sealed')
					)}>{t('settings_version.seal')}</Button
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
					onclick={() =>
						run(
							'jurisdiction_settings.update',
							{
								target: version.id,
								set: { voided_at: Instant(new Date()), void_reason: voidReason.trim() }
							},
							t('settings_version.voided')
						)}>{t('settings_version.void')}</Button
				>
			</Inline>
		</Stack>
	</Dialog.Content>
</Dialog.Root>
