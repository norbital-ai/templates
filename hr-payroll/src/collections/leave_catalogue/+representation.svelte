<script lang="ts">
	/**
	 * One row of a settings version's leave catalogue. A statutory row cites its authority and its
	 * eligibility is one CEL expression over the person, which the write hook compiles. Sealed with
	 * its version.
	 *
	 * The shared catalogue spine lives here too: destination and direction say how an entry settles
	 * (an unpaid day is PAY/SUBTRACT, an encashment PAY/ADD), the bands price it over the entry
	 * context and the convertor turns charged days and a rate into an encashment amount.
	 *
	 * Segments are tabs, not stacked sections, so one panel is on screen at a time and its fields
	 * spread across the sheet. The dialog chrome names the record; the form adds no heading.
	 *
	 * `settings_id` is never a field on the Settings page: the page names the version and the form
	 * prefills and hides it. Opened without that scope it keeps a plain version picker.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import ExpressionFields from '../../lib/ui/expression-fields.svelte';
	import ExpressionField from '../../lib/ui/expression-field.svelte';
	import { hrCreateScope } from '../../lib/ui/create-scope.js';
	import { settingsVersionSealed } from '../../lib/ui/settings-sealed.svelte.js';

	let { record, close }: RepresentationProps = $props();
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
		collection="leave_catalogue"
		defaultValues={formValues}
		readonly={sealed}
		submitLabel={record
			? t('component.save_catalogue_leave')
			: t('component.create_catalogue_leave')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field, form })}
			{#snippet identity()}
				<Stack gap="sm">
					<p class="text-meta">{t('component.leave_section_identity_hint')}</p>
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
						<Field name="is_statutory" label={t('component.is_statutory')} />
						<Field name="authority" label={t('component.authority')} />
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
				<Field
					name="eligibility"
					label={t('component.who_receives')}
					description={t('component.eligibility_hint')}
					descriptionExtra={whoMembers}
					renderer={ExpressionField}
					rendererProps={{ site: 'person', type: 'boolean' }}
					placeholder={t('component.eligibility_placeholder')}
				/>
			{/snippet}

			{#snippet entitlement()}
				<Stack gap="sm">
					<p class="text-meta">{t('component.leave_section_entitlement_hint')}</p>
					<Field name="entitlement" label={t('component.entitlement_matrix')} />
				</Stack>
			{/snippet}

			{#snippet pricing()}
				<Stack gap="sm">
					<p class="text-meta">{t('component.leave_section_pricing_hint')}</p>
					<Grid gap="md" minimum="card">
						<Field name="evidence" label={t('component.evidence')} />
						<Column span="all"><Field name="bands" label={t('component.rate_bands')} /></Column>
					</Grid>
				</Stack>
			{/snippet}

			{#snippet pay()}
				<Stack gap="sm">
					<p class="text-meta">{t('component.leave_section_pay_hint')}</p>
					<Grid gap="md" minimum="card">
						<Field name="paid" label={t('component.paid')} />
						<Field
							name="evidence_after_days"
							label={t('component.certificate_required_after_days')}
						/>
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

			<Tabs
				animate={false}
				listClass="w-full"
				contentPadding={false}
				lazyLoad={false}
				keepAlive
				config={[
					{
						name: 'identity',
						label: t('component.leave_section_identity'),
						icon: 'lucide:tag',
						content: identity
					},
					{
						name: 'who',
						label: t('component.who_may_take_it'),
						icon: 'lucide:users',
						content: who
					},
					{
						name: 'entitlement',
						label: t('component.leave_section_entitlement'),
						icon: 'lucide:calendar-days',
						content: entitlement
					},
					{
						name: 'pricing',
						label: t('component.leave_section_pricing'),
						icon: 'lucide:shield',
						content: pricing
					},
					{
						name: 'pay',
						label: t('component.leave_section_pay'),
						icon: 'lucide:circle-dollar-sign',
						content: pay
					}
				] satisfies TabConfig[]}
			/>
		{/snippet}
	</CollectionForm>
</RecordShell>
