<script lang="ts">
	import { client } from '../workspace-client.js';
	import { getErrorMessage } from '@norbital-ai/std/error';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Cluster } from '@norbital-ai/ui/layout';
	import { submitCollectionMutation } from '@norbital-ai/ui/collection-form';
	import { Effect } from 'effect';
	import { toast } from 'svelte-sonner';
	import HolidaySourceRenderer from '../../datatypes/holiday_source/+renderer.svelte';
	import type { WorkspaceRow } from '$bolt/types.js';

	let { version }: { version: WorkspaceRow<'jurisdiction_settings'> } = $props();
	const { t } = useI18n<TenantI18nKeys>();
	/**
	 * One-column write, like the seal and the void: a whole-row form would carry `sealed_at` and
	 * be routed to approval, while the source is operational configuration set under a seal.
	 * The draft follows the version, not the row: a live update after a save re-emits the same
	 * version and used to wipe whatever had been typed since.
	 */
	let sourceDraft = $state<WorkspaceRow<'jurisdiction_settings'>['holiday_source']>(null);
	let sourceError = $state<string | null>(null);
	let draftFor = $state<string | null>(null);
	$effect(() => {
		if (draftFor === version.id) return;
		draftFor = version.id;
		sourceDraft = version.holiday_source;
	});
</script>

<form
	class="flex flex-col gap-3"
	data-holiday-source-form
	onsubmit={(event) => {
		event.preventDefault();
		sourceError = null;
		Effect.runFork(
			submitCollectionMutation(() =>
				client.db.jurisdiction_settings.mutate([{ id: version.id, holiday_source: sourceDraft }])
			).pipe(
				Effect.tap(() => Effect.sync(() => toast.success(t('holiday_source.saved')))),
				Effect.catch((cause) =>
					Effect.sync(() => {
						sourceError = getErrorMessage(cause);
					})
				)
			)
		);
	}}
>
	<div data-collection-field="holiday_source" class="flex flex-col gap-2">
		<label class="text-sm font-semibold" for="holiday-source-calendar"
			>{t('holiday_source.title')}</label
		>
		<HolidaySourceRenderer
			mode="edit"
			field={{ name: 'holiday_source', type: 'custom' }}
			value={sourceDraft}
			disabled={false}
			onValueChange={(value) => {
				sourceDraft = value;
			}}
		/>
	</div>
	{#if sourceError}<p class="text-sm text-destructive" role="alert">{sourceError}</p>{/if}
	<Cluster><Button type="submit" size="sm">{t('holiday_source.save')}</Button></Cluster>
</form>
