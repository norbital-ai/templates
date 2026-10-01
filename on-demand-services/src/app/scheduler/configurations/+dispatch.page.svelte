<script lang="ts">
	/** The dispatch thresholds the watches and the change rules read. */
	import { bolt } from '$bolt';
	import { AppShell, Center, Grid, Stack } from '@norbital-ai/ui/layout';
	import { Field, Form, Section } from '@norbital-ai/ui';
	import { live } from '../../../lib/live.svelte.js';

	const t = bolt.t;
	const settings = live(() => bolt.read('dispatch_settings', { limit: 1 }));
	const row = $derived(settings.current?.rows[0]);
	let saved = $state<string | null>(null);
</script>

<AppShell
	icon="lucide:sliders-horizontal"
	title={t('app.configurations.dispatch_title')}
	description={t('app.configurations.dispatch_description')}
>
	<Center measure="narrow">
		{#if settings.current === undefined}
			<p class="text-caption">{t('component.loading')}</p>
		{:else}
			<Form
				of="dispatch_settings"
				mode={row === undefined ? 'create' : 'update'}
				{...row === undefined ? {} : { id: row.id }}
				submit={t('app.configurations.save')}
				onOutcome={(o) => (saved = o.kind === 'committed' ? t('app.configurations.saved') : null)}
			>
				<Stack gap="lg">
					<Section first name="eta" title={t('app.configurations.section_eta')}>
						<Grid minimum="card">
							<Field
								name="eta_limit_minutes"
								label={t('component.eta_limit_minutes')}
								help={t('component.eta_limit_minutes_help')}
							/>
							<Field
								name="eta_check_lead_minutes"
								label={t('component.eta_check_lead_minutes')}
								help={t('component.eta_check_lead_minutes_help')}
							/>
						</Grid>
					</Section>
					<Section name="shift" title={t('app.configurations.section_shift')}>
						<Grid minimum="card">
							<Field
								name="shift_check_lead_minutes"
								label={t('component.shift_check_lead_minutes')}
								help={t('component.shift_check_lead_minutes_help')}
							/>
							<Field
								name="shift_reply_minutes"
								label={t('component.shift_reply_minutes')}
								help={t('component.shift_reply_minutes_help')}
							/>
						</Grid>
					</Section>
					<Section name="changes" title={t('app.configurations.section_changes')}>
						<Grid minimum="card">
							<Field
								name="free_change_hours"
								label={t('component.free_change_hours')}
								help={t('component.free_change_hours_help')}
							/>
						</Grid>
					</Section>
					{#if saved}<p role="status" class="text-sm text-success">{saved}</p>{/if}
				</Stack>
			</Form>
		{/if}
	</Center>
</AppShell>
