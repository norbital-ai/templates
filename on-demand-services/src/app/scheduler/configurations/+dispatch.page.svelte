<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { ctx }: { ctx: PageContext } = $props();
	/** The dispatch thresholds the watches and the change rules read. */
	import { AppShell, Grid, Stack } from '@norbital-ai/ui/layout';
	import { Field, Form, Section } from '@norbital-ai/ui';
	const t = ctx.t;
	const settings = $derived(ctx.query({ dispatch_settings: { limit: 1 } }));
	const row = $derived(settings.current?.dispatch_settings.rows[0]);
	let saved = $state<string | null>(null);
</script>

<AppShell
	icon="lucide:sliders-horizontal"
	title={t('app.configurations.dispatch_title')}
	description={t('app.configurations.dispatch_description')}
>
	{#if settings.current === undefined}
		<p class="text-caption">{t('component.loading')}</p>
	{:else}
		<Form
			{ctx}
			of="dispatch_settings"
			mode={row === undefined ? 'create' : 'update'}
			{...row === undefined ? {} : { id: row.id }}
			submit={t('app.configurations.save')}
			on_outcome={(o) => (saved = o.kind === 'committed' ? t('app.configurations.saved') : null)}
		>
			<Stack gap="lg">
				<Section
					icon="lucide:clock"
					collapsible={false}
					first
					name="eta"
					title={t('app.configurations.section_eta')}
				>
					<Grid minimum="compact">
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
					icon="lucide:clock"
					collapsible={false}
					name="shift"
					title={t('app.configurations.section_shift')}
				>
					<Grid minimum="compact">
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
				<!-- one setting: a section groups at least two controls, so it stands in the flow on its own -->
				<Grid minimum="compact">
					<Field
						{ctx}
						name="free_change_hours"
						label={t('component.free_change_hours')}
						help={t('component.free_change_hours_help')}
					/>
				</Grid>
				{#if saved}<p role="status" class="text-sm text-success">{saved}</p>{/if}
			</Stack>
		</Form>
	{/if}
</AppShell>
