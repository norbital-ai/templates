<script lang="ts">
	/**
	 * The payment catalogue's own form.
	 *
	 * It shared `catalogue-form.svelte` with claims while the row was the same one. `source` and
	 * `schedule` ended that, the way the recurrence facts did for allowances: a form
	 * serving rows of different shapes can be typed against only their intersection.
	 *
	 * Segments are tabs, not stacked sections. `settings_id` is never a field on the Settings page:
	 * the page names the version and the form prefills and hides it.
	 */
	import { client } from '../workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import ExpressionFields from './expression-fields.svelte';
	import ExpressionField from './expression-field.svelte';
	import { hrCreateScope } from './create-scope.js';
	import { settingsVersionSealed } from './settings-sealed.svelte.js';

	type Collection = 'payment_catalogue';
	let { record, close }: { record: WorkspaceRow<Collection> | null; close: () => void } = $props();
	const collection: Collection = 'payment_catalogue';
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const settingsId = $derived(createScope?.settingsId?.());
	const formValues = $derived(record ?? (settingsId ? { settings_id: settingsId } : undefined));
	const sealed = $derived(settingsVersionSealed(() => record?.settings_id)());
	/** EMPLOYER and DISPLAY settle no direction: the model keeps it null there. */
	const takesDirection = (destination: unknown): boolean =>
		destination === 'PAY' || destination === 'NET';
</script>

<RecordShell
	icon={sealed ? 'lucide:lock-keyhole' : undefined}
	badge={sealed ? t('component.settings_sealed_badge') : undefined}
>
	<CollectionForm
		{client}
		{collection}
		defaultValues={formValues}
		readonly={sealed}
		submitLabel={record
			? t('component.save_catalogue_component')
			: t('component.create_catalogue_component')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field, form })}
			{#snippet payLine()}
				<Stack gap="sm">
					<p class="text-meta">{t('component.catalogue_section_pay_line_hint')}</p>
					<Grid gap="md" minimum="card">
						{#if settingsId != null || record != null}
							<Field name="settings_id" hidden />
						{:else}
							<Field
								name="settings_id"
								label={t('component.settings_version')}
								relationOptions={{
									label: (version) =>
										[version.code, version.name, version.sealed_at ? 'sealed' : 'draft']
											.filter((part) => part != null && part !== '')
											.join(' · ') || '—',
									orderBy: { code: 'asc' },
									limit: 500
								}}
							/>
						{/if}
						<Field name="code" label={t('component.code')} />
						<Field name="name" label={t('component.name')} />
						<Field name="destination" label={t('component.destination')} />
						{#if takesDirection(form.values().destination)}
							<Field name="direction" label={t('component.direction')} />
						{:else}
							<Field name="direction" hidden />
							<span
								class="hidden"
								{@attach () => {
									if (form.values().direction != null)
										form.setValues({ ...form.values(), direction: null });
								}}
							></span>
						{/if}
					</Grid>
				</Stack>
			{/snippet}

			{#snippet whoMembers()}
				<ExpressionFields
					site="person"
					expression={String(form.values().eligibility ?? '')}
					type="boolean"
					mode="members"
				/>
			{/snippet}

			{#snippet who()}
				<Grid gap="md" minimum="card">
					<Field
						name="eligibility"
						label={t('component.who_receives')}
						description={t('component.eligibility_hint')}
						descriptionExtra={whoMembers}
						renderer={ExpressionField}
						rendererProps={{ site: 'person', type: 'boolean' }}
						placeholder={t('component.eligibility_placeholder')}
					/>
				</Grid>
			{/snippet}

			{#snippet limits()}
				<Stack gap="sm">
					<p class="text-meta">{t('component.catalogue_section_limits_hint')}</p>
					<Grid gap="md" minimum="card">
						<Field
							name="source"
							label={t('component.source')}
							description={t('component.source_hint')}
						/>
						{#if form.values().source === 'SCHEDULE'}
							<Column span="all"><Field name="schedule" label={t('component.schedule')} /></Column>
						{:else}
							<Field name="schedule" hidden />
						{/if}
					</Grid>
					<Grid gap="md" minimum="card">
						<Field name="evidence" label={t('component.evidence')} />
						<Column span="all"><Field name="bands" label={t('component.rate_bands')} /></Column>
					</Grid>
				</Stack>
			{/snippet}

			<Tabs
				animate={false}
				listClass="w-full"
				contentPadding={false}
				lazyLoad={false}
				keepAlive
				config={[
					{
						name: 'pay_line',
						label: t('component.catalogue_section_pay_line'),
						icon: 'lucide:tag',
						content: payLine
					},
					{
						name: 'who',
						label: t('component.catalogue_section_who_order'),
						icon: 'lucide:users',
						content: who
					},
					{
						name: 'limits',
						label: t('component.catalogue_section_limits'),
						icon: 'lucide:shield',
						content: limits
					}
				] satisfies TabConfig[]}
			/>
		{/snippet}
	</CollectionForm>
</RecordShell>
