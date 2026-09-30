<script lang="ts">
	/**
	 * What needs a person: visits flagged by the ETA check, left without a helper or waiting on a proposal; shift checks
	 * still open; and the warning letters on file.
	 */
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, Table, Tabs } from '@norbital-ai/ui';

	const t = bolt.t;
</script>

{#snippet calm(message: string)}
	<EmptyState variant="inset" title={message} />
{/snippet}
{#snippet noAttention()}{@render calm(t('app.schedule.all_clear'))}{/snippet}
{#snippet noShifts()}{@render calm(t('app.schedule.no_open_shift_checks'))}{/snippet}
{#snippet noLetters()}{@render calm(t('app.schedule.no_warning_letters'))}{/snippet}

{#snippet attention()}
	<Table
		empty={noAttention}
		of="visits"
		key="attention"
		toolbar={{ title: t('app.schedule.needs_attention'), new: false }}
		where={{ attention: { ne: 'none' }, status: { eq: 'scheduled' } }}
		orderBy={{ number: 'asc' }}
		columns={[
			'number',
			'slot',
			'attention',
			'helper',
			'eta_minutes',
			'proposed_helper',
			'proposed_slot',
			'address'
		]}
		actions={[
			{ action: 'visits.reassign', label: t('app.schedule.auto_reassign') },
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
