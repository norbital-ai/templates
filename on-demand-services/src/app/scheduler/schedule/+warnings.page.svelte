<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { ctx }: { ctx: PageContext } = $props();
	import { EmptyState, Table, Tabs } from '@norbital-ai/ui';
	/**
	 * What needs a person: visits flagged by the ETA check, left without a helper or waiting on a proposal; shift checks
	 * still open; and the warning letters on file.
	 */
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import type { ListRow } from '@norbital-ai/bolt';
	import Countdown from '../../../lib/Countdown.svelte';
	const zone = ctx.tz;
	const t = ctx.t;
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
			>{new Intl.DateTimeFormat(ctx.locale, {
				timeZone: zone,
				day: 'numeric',
				month: 'short',
				hour: 'numeric',
				minute: '2-digit'
			}).format(new Date(row.slot.start))}</span
		><Countdown {ctx} start={row.slot.start} /></Stack
	>
{/snippet}
{#snippet attention()}
	<Table
		{ctx}
		empty={noAttention}
		of="visits"
		key="attention"
		toolbar={{ title: t('app.schedule.needs_attention'), new: false }}
		where={{ attention: { ne: 'none' }, status: { eq: 'scheduled' } }}
		order_by={{ number: 'asc' }}
		columns={[
			'number',
			'attention',
			'proposed_helper',
			{ field: 'slot', label: t('models.visits.fields.slot'), cell: timerCell }
		]}
		actions={[
			{
				run: (row) => ctx.run('visits_recommend', { targets: [row.id] }),
				label: t('app.schedule.auto_reassign')
			},
			{
				run: (row) => ctx.run('visits_accept_proposal', { targets: [row.id] }),
				label: t('app.schedule.accept_proposal')
			},
			{
				run: (row) => ctx.run('visits_cancel', { targets: [row.id] }),
				label: t('app.schedule.cancel_visit'),
				confirm: t('app.schedule.cancel_visit_confirm')
			}
		]}
	/>
{/snippet}
{#snippet shifts()}
	<Table
		{ctx}
		empty={noShifts}
		of="visits"
		key="shifts"
		toolbar={{ title: t('app.schedule.open_shift_checks'), new: false }}
		where={{
			status: { eq: 'scheduled' },
			shift_check: { in: ['asked', 'declined', 'no_response'] }
		}}
		order_by={{ number: 'asc' }}
		columns={['number', 'slot', 'helper', 'shift_check', 'shift_asked_at', 'mc']}
	/>
{/snippet}
{#snippet letters()}
	<Table
		{ctx}
		empty={noLetters}
		of="helper_warnings"
		order_by={{ issued_at: 'desc' }}
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
