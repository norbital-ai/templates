<script lang="ts">
	/** A helper's profile, with their upcoming visits, time off and warnings. */
	import { bolt } from '$bolt';
	import type { RecordSection, RecordView } from '@norbital-ai/ui';
	import { RecordShell, Table } from '@norbital-ai/ui';
	import { when } from '../../../lib/summary.js';

	let { view }: { view: RecordView<'helpers'> } = $props();
	const t = bolt.t;
	const record = $derived(view.mode === 'update' ? view.record : null);
	// who they are, what they do and when they work stay open (dispatch reads them); the sign-in account and the map
	// pins fold away
	const sections: RecordSection[] = [
		{
			name: 'helper',
			title: t('models.helpers.singular'),
			fields: ['name', 'phone', 'status', 'left_on', 'skills', 'home_area', 'warning_count']
		},
		{
			name: 'availability',
			title: t('section.availability'),
			fields: ['work_days', 'day_start', 'day_end']
		},
		{
			name: 'account_location',
			title: t('section.account_location'),
			fields: ['user', 'home_location', 'last_location', 'last_location_at'],
			defaultOpen: false,
			summary: (r) =>
				r.last_location_at == null
					? t('summary.no_location')
					: t('summary.last_seen', { at: when(String(r.last_location_at)) })
		}
	];
</script>

{#snippet visits()}
	{#if record}<Table
			of="visits"
			key="helper-visits"
			toolbar={{ title: t('app.helpers.visits'), new: false }}
			where={{ helper: { eq: record.id } }}
			initialFilter={{ status: { in: ['scheduled', 'in_progress'] } }}
			orderBy={{ number: 'asc' }}
			columns={['number', 'slot', 'address', 'status', 'shift_check']}
		/>{/if}
{/snippet}
{#snippet timeOff()}
	{#if record}<Table
			of="helper_time_off"
			key="helper-time-off"
			toolbar={{ title: t('app.helpers.time_off') }}
			where={{ helper: { eq: record.id } }}
			columns={['period', 'reason']}
		/>{/if}
{/snippet}
{#snippet warnings()}
	{#if record}<Table
			of="helper_warnings"
			key="helper-warnings"
			toolbar={{ title: t('app.helpers.warnings'), new: false }}
			where={{ helper: { eq: record.id } }}
			orderBy={{ issued_at: 'desc' }}
			columns={['reason', 'issued_at', 'visit', 'letter']}
		/>{/if}
{/snippet}

{#if record === null}
	<RecordShell
		of="helpers"
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
		{sections}
	/>
{:else}
	<RecordShell
		of="helpers"
		id={record.id}
		title={record.name}
		{sections}
		tabs={[
			{
				name: 'visits',
				title: t('app.helpers.visits'),
				icon: 'lucide:calendar-clock',
				body: visits
			},
			{
				name: 'time_off',
				title: t('app.helpers.time_off'),
				icon: 'lucide:calendar-off',
				body: timeOff
			},
			{
				name: 'warnings',
				title: t('app.helpers.warnings'),
				icon: 'lucide:file-warning',
				body: warnings
			}
		]}
	/>
{/if}
