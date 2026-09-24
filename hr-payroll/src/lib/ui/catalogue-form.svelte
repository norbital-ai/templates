<script
	lang="ts"
	generics="C extends 'claim_catalogue' | 'adhoc_catalogue' | 'allowance_catalogue'"
>
	/**
	 * The one form behind the claim, ad hoc and allowance catalogues. Their rows share the pay line,
	 * the eligibility, the rate bands and the schemes they count toward; each catalogue's own
	 * columns arrive as the `payLineFields` and `limitFields` snippets, composed with a `Field`
	 * typed against that catalogue's row.
	 *
	 * The loan catalogue keeps its own form: `loan_type`/`minimum_repayment` and its recovery rule
	 * are not a few extra fields but a different pay line.
	 *
	 * Segments are tabs, not stacked sections: one panel is on screen at a time, its segment name is
	 * the tab label, and its fields spread across the sheet instead of down it. The dialog chrome
	 * already names the record, so the form adds no heading of its own.
	 *
	 * `settings_id` is never a field on the Settings page: the page names the version and the form
	 * prefills and hides it. Opened without that scope it keeps a plain version picker.
	 */
	import { client } from '../workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import type { WorkspaceCollections } from '$bolt/client';
	import type { Snippet } from 'svelte';
	import { CollectionForm, type CollectionFormComposition } from '@norbital-ai/ui/collection-form';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import ExpressionFields from './expression-fields.svelte';
	import ExpressionField from './expression-field.svelte';
	import CountsTowardField from './counts-toward-field.svelte';
	import { hrCreateScope } from './create-scope.js';
	import { settingsVersionSealed } from './settings-sealed.svelte.js';

	type Catalogue = 'claim_catalogue' | 'adhoc_catalogue' | 'allowance_catalogue';
	/** What a catalogue's own snippet composes with: a `Field` typed against that catalogue's row. */
	type OwnComposition = CollectionFormComposition<WorkspaceCollections, C>;
	type CatalogueFormProps = {
		collection: C;
		record: WorkspaceRow<Catalogue> | null;
		close: () => void;
		/** The catalogue's own pay-line columns, after the direction. */
		payLineFields?: Snippet<[OwnComposition]>;
		/** The catalogue's own limits, before the rate bands. */
		limitFields?: Snippet<[OwnComposition]>;
	};
	let { collection, record, close, payLineFields, limitFields }: CatalogueFormProps = $props();
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
	hint={sealed ? t('component.settings_sealed_note') : undefined}
>
	<CollectionForm
		{client}
		collection={collection as Catalogue}
		defaultValues={formValues}
		readonly={sealed}
		submitLabel={record
			? t('component.save_catalogue_component')
			: t('component.create_catalogue_component')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children(composition)}
			{@const { Field, form } = composition}
			<!-- The form is on `collection`, so its Field names that catalogue's own columns too. -->
			{@const own = composition as unknown as OwnComposition}
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
						{@render payLineFields?.(own)}
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
					<p class="text-meta">
						{collection === 'allowance_catalogue'
							? t('component.allowance_section_pricing_hint')
							: t('component.catalogue_section_limits_hint')}
					</p>
					<Grid gap="md" minimum="card">
						{@render limitFields?.(own)}
						<Column span="all"><Field name="bands" label={t('component.rate_bands')} /></Column>
					</Grid>
				</Stack>
			{/snippet}

			{#snippet countsToward()}
				<Stack gap="sm">
					<p class="text-meta">{t('component.catalogue_section_counts_toward_hint')}</p>
					<Field
						name="counts_toward"
						label={t('component.counts_toward')}
						description={t('component.counts_toward_hint')}
						renderer={CountsTowardField}
					/>
				</Stack>
			{/snippet}

			<Tabs
				animate={false}
				listClass="w-full"
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
					},
					{
						name: 'counts_toward',
						label: t('component.catalogue_section_counts_toward'),
						icon: 'lucide:landmark',
						content: countsToward
					}
				] satisfies TabConfig[]}
			/>
		{/snippet}
	</CollectionForm>
</RecordShell>
