<script lang="ts">
	/**
	 * What needs a person: visits flagged by the ETA check, left without a helper or waiting on a proposal; shift checks
	 * still open; and the warning letters on file.
	 */
	import { bolt } from '$bolt';
	import { AppShell, Stack, Cluster } from '@norbital-ai/ui/layout';
	import { EmptyState, Table, Tabs, Button, Sheet } from '@norbital-ai/ui';

	import type { Id, ListRow } from '@norbital-ai/bolt';
	import Recovery from '../../../lib/Recovery.svelte';
	import Countdown from '../../../lib/Countdown.svelte';
	let selected = $state<Id<'visits'> | null>(null);
	const t = bolt.t;
</script>

{#snippet calm(message: string)}
	<EmptyState variant="inset" title={message} />
{/snippet}
{#snippet noAttention()}{@render calm(t('app.schedule.all_clear'))}{/snippet}
{#snippet noShifts()}{@render calm(t('app.schedule.no_open_shift_checks'))}{/snippet}
{#snippet noLetters()}{@render calm(t('app.schedule.no_warning_letters'))}{/snippet}

{#snippet timerCell({ row }: { row: ListRow<'visits'> })}
	<Stack gap="xs"
		><span
			>{new Intl.DateTimeFormat(bolt.locale, {
				day: 'numeric',
				month: 'short',
				hour: 'numeric',
				minute: '2-digit'
			}).format(new Date(row.slot.start))}</span
		><Countdown start={row.slot.start} /></Stack
	>
{/snippet}
{#snippet reviewCell({ row }: { row: ListRow<'visits'> })}
	<Cluster gap="sm"
		><span>{row.number}</span><Button
			variant="outline"
			size="sm"
			onclick={() => (selected = row.id)}>{t('app.recovery.review')}</Button
		></Cluster
	>
{/snippet}
{#snippet attention()}
	<Table
		empty={noAttention}
		of="visits"
		key="attention"
		toolbar={{ title: t('app.schedule.needs_attention'), new: false }}
		where={{ attention: { ne: 'none' }, status: { eq: 'scheduled' } }}
		orderBy={{ number: 'asc' }}
		columns={[
			{ field: 'number', label: t('app.recovery.review'), cell: reviewCell },
			'attention',
			'proposed_helper',
			{ field: 'slot', label: t('models.visits.fields.slot'), cell: timerCell }
		]}
		actions={[
			{ action: 'visits.recommend', label: t('app.schedule.auto_reassign') },
			{ action: 'visits.accept_proposal', label: t('app.schedule.accept_proposal') },
			{
				action: 'visits.cancel',
				label: t('app.schedule.cancel_visit'),
				confirm: t('app.schedule.cancel_visit_confirm')
			}
		]}
	/>
{/snippet}
{#snippet shifts()}
	<Table
		empty={noShifts}
		of="visits"
		key="shifts"
		toolbar={{ title: t('app.schedule.open_shift_checks'), new: false }}
		where={{
			status: { eq: 'scheduled' },
			shift_check: { in: ['asked', 'declined', 'no_response'] }
		}}
		orderBy={{ number: 'asc' }}
		columns={['number', 'slot', 'helper', 'shift_check', 'shift_asked_at', 'mc']}
	/>
{/snippet}
{#snippet letters()}
	<Table
		empty={noLetters}
		of="helper_warnings"
		orderBy={{ issued_at: 'desc' }}
		toolbar={{ title: t('app.schedule.warning_letters'), new: false }}
		columns={['helper', 'reason', 'issued_at', 'visit', 'letter']}
	/>
{/snippet}

<AppShell
	icon="lucide:siren"
	title={t('app.schedule.warnings_title')}
	description={t('app.schedule.warnings_description')}
	variant="full"
>
	<Tabs
		tabs={[
			{
				name: 'attention',
				title: t('app.schedule.needs_attention'),
				icon: 'lucide:siren',
				body: attention
			},
			{
				name: 'shifts',
				title: t('app.schedule.open_shift_checks'),
				icon: 'lucide:user-check',
				body: shifts
			},
			{
				name: 'letters',
				title: t('app.schedule.warning_letters'),
				icon: 'lucide:file-warning',
				body: letters
			}
		]}
	/>
</AppShell>

<Sheet
	open={selected !== null}
	onOpenChange={(open) => {
		if (!open) selected = null;
	}}
	title={t('app.recovery.title')}
>
	{#if selected !== null}{#key selected}<Recovery visit={selected} />{/key}{/if}
</Sheet>
