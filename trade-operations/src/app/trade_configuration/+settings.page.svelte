<script lang="ts">
	/** The one commercial settings record, edited in place. */
	import { bolt } from '$bolt';
	import {
		Badge,
		Button,
		Editor,
		Field,
		Form,
		Section,
		useKinds,
		valueObject,
		type FieldEditor,
		type RecordSection
	} from '@norbital-ai/ui';
	import { IntegrationSetup } from '@norbital-ai/bolt/page/integrations';
	import { frameworkText } from '@norbital-ai/bolt/page';
	import { AppShell, Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	import {
		kingdeeConfiguration,
		kingdeeWriteAccount
	} from '../../integration/kingdee/configuration.js';
	import { kingdeeConnectionStatus } from '../../integration/kingdee/connection-status.js';

	const kinds = useKinds();
	let managing = $state<string | null>(null);
	const ledgers = bolt.query({
		sys_integration: {
			where: { integration: { eq: 'kingdee' } },
			fields: ['name', 'active', 'status', 'configuration']
		}
	});
	const settings = bolt.query({ commercial_settings: { limit: 1 } });
	const row = $derived(settings.current?.commercial_settings.rows[0]);
	const sections = $derived<RecordSection[]>([
		{
			name: 'documents',
			icon: 'lucide:file-text',
			title: bolt.t('models.document_templates.label'),
			fields: ['default_document_layout', 'default_purchase_document_layout']
		},
		{
			name: 'pricing',
			icon: 'lucide:tag',
			title: bolt.t('section.pricing'),
			fields: ['freight_treatment', 'require_floor']
		},
		{
			name: 'freshness',
			icon: 'lucide:clock',
			title: bolt.t('section.data_freshness'),
			fields: ['credit_fresh_minutes', 'stock_fresh_minutes'],
			defaultOpen: false
		}
	]);
	let saved = $state<string | null>(null);
</script>

{#snippet ledgerConfiguration(field: FieldEditor)}
	{@const values = valueObject(field.value) ? field.value : {}}
	<Grid minimum="compact">
		{#each Object.entries(kingdeeConfiguration) as [name, kind] (name)}
			<div>
				<label for={`${field.id}-${name}`} class="text-sm font-medium">{kind.label}</label>
				<Editor
					id={`${field.id}-${name}`}
					{name}
					{kind}
					value={values[name] ?? null}
					disabled={field.disabled}
					onChange={(value) => field.onChange({ ...values, [name]: value })}
				/>
			</div>
		{/each}
	</Grid>
{/snippet}
<AppShell
	icon="lucide:settings"
	title={bolt.t('models.commercial_settings.label')}
	description={bolt.t('app.trade_configuration.description')}
	variant="full"
>
	<Scroll name="commercial-settings" size="fill" inset class="pt-4">
		<Stack gap="lg">
			<Section name="kingdee" icon="lucide:database" title="Kingdee" first>
				<Stack gap="sm">
					{#if ledgers.error}<p role="alert" class="text-sm">{ledgers.error.message}</p>
					{:else if ledgers.current}
						{#each ledgers.current.sys_integration.rows as ledger (ledger.id)}
							{@const status = kingdeeConnectionStatus(ledger)}
							<div class="flex flex-wrap items-center gap-2 text-sm">
								<span>{ledger.name}</span>
								<Badge variant={status === 'connected' ? 'success' : 'outline'}>
									{bolt.t(`component.kingdee_${status}`)}
								</Badge>
								{#if status === 'connected'}
									<Badge variant="outline">
										{bolt.t(
											kingdeeWriteAccount(ledger.configuration) === null
												? 'component.kingdee_read_only'
												: 'component.kingdee_write_account_configured'
										)}
									</Badge>
								{/if}
								{#if kinds.catalog?.sys_integration?.update}
									<Button
										variant="outline"
										onclick={() => (managing = managing === ledger.id ? null : ledger.id)}
									>
										{bolt.t(
											managing === ledger.id
												? 'component.kingdee_hide_connection'
												: 'component.kingdee_manage_connection'
										)}
									</Button>
								{/if}
							</div>
							{#if managing === ledger.id}
								<Stack gap="md">
									{#if !ledger.active}
										<p class="text-sm text-muted-foreground">
											{bolt.t('component.kingdee_paused_help')}
										</p>
									{/if}
									<IntegrationSetup
										client={bolt.integration(ledger.id)}
										t={(key) => frameworkText(bolt.locale)[key] ?? key}
										locale={bolt.locale}
									/>
									<Section
										name="sync-options"
										title={bolt.t('component.kingdee_sync_options')}
										defaultOpen={false}
									>
										<Form of="sys_integration" mode="update" id={ledger.id}>
											<Field name="active" label={bolt.t('component.kingdee_enable_sync')} />
											<Field name="configuration">
												{#snippet editor(field)}{@render ledgerConfiguration(field)}{/snippet}
											</Field>
										</Form>
									</Section>
								</Stack>
							{/if}
						{:else}
							<p class="text-sm">{bolt.t('component.kingdee_off')}</p>
						{/each}
						<p class="text-sm text-muted-foreground">{bolt.t('component.kingdee_setup_help')}</p>
					{/if}
				</Stack>
			</Section>
			{#if settings.current === undefined}
				<p role="status" class="text-sm text-muted-foreground">
					{settings.error ? settings.error.message : bolt.t('component.settings_loading')}
				</p>
			{:else}
				<Form
					of="commercial_settings"
					mode={row === undefined ? 'create' : 'update'}
					{...row === undefined ? {} : { id: row.id, record: row }}
					{sections}
					onOutcome={(o) =>
						(saved = o.kind === 'committed' ? bolt.t('component.settings_saved') : null)}
				/>
				{#if saved}<p role="status" class="text-sm text-success">{saved}</p>{/if}
			{/if}
		</Stack>
	</Scroll>
</AppShell>
