<script lang="ts">
	/** A visit, and for dispatch the helpers who could take it instead, best match first, each one click away. */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import type { RecordView } from '@norbital-ai/ui';
	import { Button, RecordShell, Table, useKinds } from '@norbital-ai/ui';
	import { live } from '../../../lib/live.svelte.js';

	let { view }: { view: RecordView<'visits'> } = $props();
	const t = bolt.t;
	const kinds = useKinds();
	const record = $derived(view.mode === 'update' ? view.record : null);
	/** Only dispatch reads warnings; a helper's catalogue has no such collection. */
	const dispatcher = $derived(kinds.catalog?.['helper_warnings'] !== undefined);
	const candidates = live(
		() =>
			record !== null && dispatcher && record.status === 'scheduled'
				? bolt.query('visits.candidates', { visit: record.id })
				: null,
		['visits', 'helpers', 'helper_time_off']
	);
	let message = $state<string | null>(null);

	async function assign(helper: Id<'helpers'>) {
		if (record === null) return;
		const outcome = await bolt.act('visits.reassign', { target: record.id, input: { helper } });
		message = outcome.kind === 'refused' ? outcome.message : null;
	}
</script>

{#snippet assignCell({ row }: { row: { helper: Id<'helpers'> } })}
	<Button size="sm" variant="outline" onclick={() => assign(row.helper)}
		>{t('app.schedule.assign')}</Button
	>
{/snippet}

{#snippet free()}
	<Table
		of={candidates.current ?? []}
		toolbar={{ title: t('app.schedule.free_helpers'), description: message ?? false }}
		columns={[
			{ field: 'name', label: t('component.helper') },
			{ field: 'drive_minutes', label: t('component.drive_minutes') },
			{ field: 'same_area', label: t('component.same_area') },
			{ field: 'week_load', label: t('component.week_load') },
			{ field: 'helper', label: t('app.schedule.assign'), cell: assignCell }
		]}
	/>
{/snippet}

{#if record !== null}
	<RecordShell
		of="visits"
		id={record.id}
		tabs={dispatcher && record.status === 'scheduled'
			? [
					{
						name: 'free',
						title: t('app.schedule.free_helpers'),
						icon: 'lucide:user-search',
						body: free
					}
				]
			: []}
	/>
{/if}
