<script lang="ts">
	/** The one commercial settings record, edited in place. */
	import { bolt } from '$bolt';
	import { Field, Form, Section } from '@norbital-ai/ui';
	import { AppShell, Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	const settings = bolt.query({ commercial_settings: { limit: 1 } });
	const row = $derived(settings.current?.commercial_settings.rows[0]);
	let saved = $state<string | null>(null);
</script>

<AppShell
	icon="lucide:settings"
	title={bolt.t('models.commercial_settings.label')}
	description={bolt.t('app.trade_configuration.description')}
	variant="full"
>
	<Scroll name="commercial-settings" size="fill" inset>
		{#if settings.current === undefined}
			<p role="status" class="text-sm text-muted-foreground">
				{settings.error ? settings.error.message : bolt.t('component.settings_loading')}
			</p>
		{:else}
			<Form
				of="commercial_settings"
				mode={row === undefined ? 'create' : 'update'}
				{...row === undefined ? {} : { id: row.id }}
				onOutcome={(o) =>
					(saved = o.kind === 'committed' ? bolt.t('component.settings_saved') : null)}
			>
				<Stack gap="lg">
					<Section collapsible={false} first name="pricing" title={bolt.t('section.pricing')}>
						<Grid minimum="compact">
							<Field name="freight_treatment" />
							<Field name="require_floor" />
						</Grid>
					</Section>
					<Section collapsible={false} name="freshness" title={bolt.t('section.data_freshness')}>
						<Grid minimum="compact">
							<Field name="credit_fresh_minutes" />
							<Field name="stock_fresh_minutes" />
						</Grid>
					</Section>
					{#if saved}<p role="status" class="text-sm text-success">{saved}</p>{/if}
				</Stack>
			</Form>
		{/if}
	</Scroll>
</AppShell>
