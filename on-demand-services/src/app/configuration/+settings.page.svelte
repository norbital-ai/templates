<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Alert, Field, Form, RecordShell, Section, Spinner } from '@norbital-ai/ui';
	import { AppShell, Grid, Inline, Stack, Surface } from '@norbital-ai/ui/layout';

	let { ctx }: { ctx: PageContext } = $props();
	const t = (...args: Parameters<PageContext['t']>) => ctx.t(...args);
	const settings = $derived(ctx.query({ scheduling_settings: { limit: 1 } }));
	const row = $derived(settings.current?.scheduling_settings.rows[0]);
	let saved = $state<string | null>(null);
</script>

<AppShell
	icon="lucide:sliders-horizontal"
	title={t('app.configuration.settings_title')}
	description={t('app.configuration.settings_description')}
>
	{#if settings.error}
		<Alert.Root variant="destructive">
			<Alert.Title>{settings.error.message}</Alert.Title>
		</Alert.Root>
	{:else if settings.current === undefined}
		<Surface tone="subtle" padding="md" radius="control" role="status" aria-busy="true">
			<Inline gap="sm" align="center">
				<Spinner />
				<span class="text-sm text-muted-foreground">{t('component.loading')}</span>
			</Inline>
		</Surface>
	{:else}
		{#key row?.id}
			<RecordShell
				{ctx}
				of="scheduling_settings"
				{...row === undefined ? { mode: 'create' as const } : { id: row.id }}
				footer={saved ?? ''}
				on_done={() => {}}
			>
				<Form
					{ctx}
					of="scheduling_settings"
					mode={row === undefined ? 'create' : 'update'}
					{...row === undefined ? {} : { id: row.id }}
					submit={t('app.configuration.save')}
					on_outcome={(o) => (saved = o.kind === 'committed' ? t('app.configuration.saved') : null)}
				>
					<Stack gap="lg">
						<Section
							icon="lucide:calendar-clock"
							collapsible={false}
							first
							name="booking"
							title={t('app.configuration.section_booking')}
						>
							<Grid minimum="card">
								<Field
									{ctx}
									name="slot_interval_minutes"
									label={t('component.slot_interval_minutes')}
									help={t('component.slot_interval_minutes_help')}
								/>
								<Field
									{ctx}
									name="buffer_minutes"
									label={t('component.buffer_minutes')}
									help={t('component.buffer_minutes_help')}
								/>
								<Field
									{ctx}
									name="booking_horizon_days"
									label={t('component.booking_horizon_days')}
									help={t('component.booking_horizon_days_help')}
								/>
								<Field
									{ctx}
									name="free_change_hours"
									label={t('component.free_change_hours')}
									help={t('component.free_change_hours_help')}
								/>
							</Grid>
						</Section>
						<Section
							icon="lucide:navigation"
							collapsible={false}
							name="eta"
							title={t('app.configuration.section_eta')}
						>
							<Grid minimum="card">
								<Field
									{ctx}
									name="eta_limit_minutes"
									label={t('component.eta_limit_minutes')}
									help={t('component.eta_limit_minutes_help')}
								/>
								<Field
									{ctx}
									name="eta_check_lead_minutes"
									label={t('component.eta_check_lead_minutes')}
									help={t('component.eta_check_lead_minutes_help')}
								/>
							</Grid>
						</Section>
						<Section
							icon="lucide:user-check"
							collapsible={false}
							name="shift"
							title={t('app.configuration.section_shift')}
						>
							<Grid minimum="card">
								<Field
									{ctx}
									name="shift_check_lead_minutes"
									label={t('component.shift_check_lead_minutes')}
									help={t('component.shift_check_lead_minutes_help')}
								/>
								<Field
									{ctx}
									name="shift_reply_minutes"
									label={t('component.shift_reply_minutes')}
									help={t('component.shift_reply_minutes_help')}
								/>
							</Grid>
						</Section>
					</Stack>
				</Form>
			</RecordShell>
		{/key}
	{/if}
</AppShell>
