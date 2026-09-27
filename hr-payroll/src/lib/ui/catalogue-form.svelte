<script lang="ts">
	/**
	 * The one form behind the claim, ad hoc, allowance and loan catalogues. Their rows share the pay line,
	 * the eligibility, the rate bands and the schemes they count toward; each catalogue's own
	 * columns arrive as the `payLineFields` and `limitFields` snippets, which render `Field`s of the
	 * same `Form` (they are handed its state). A loan row has no limits or scheme tabs.
	 *
	 * Segments are tabs (kept mounted, so no value is lost while another is on screen), and the
	 * record frame names the row. `settings_id` is never a field on the Settings page: the page
	 * names the version and the form prefills it. Opened without that scope it keeps a version
	 * picker. A sealed version's row says so in the frame; the transform refuses the edit.
	 */
	import { t } from './t.js';
	import type { Id } from '@norbital-ai/bolt';
	import type { Snippet } from 'svelte';
	import { Field, Form, type FormState } from '@norbital-ai/ui';
	import { Editor, Picker } from '@norbital-ai/ui';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { Tabs } from '@norbital-ai/ui';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import ExpressionFields from './expression-fields.svelte';
	import ExpressionField from './expression-field.svelte';
	import CountsTowardField from './counts-toward-field.svelte';
	import { createValues, hrCreateScope } from './create-scope.js';
	import { openCreated } from './open-created.js';
	import { settingsVersionSealed } from './settings-sealed.svelte.js';
	import * as Predicate from 'effect/Predicate';

	type Catalogue = 'claim_catalogue' | 'adhoc_catalogue' | 'allowance_catalogue' | 'loan_catalogue';
	let {
		collection,
		view,
		payLineFields,
		limitFields
	}: {
		collection: Catalogue;
		view: RecordView<Catalogue>;
		/** The catalogue's own pay-line columns, after the direction. */
		payLineFields?: Snippet<[FormState]>;
		/** The catalogue's own limits, before the rate bands. */
		limitFields?: Snippet<[FormState]>;
	} = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const scopedSettingsId = $derived(hrCreateScope()?.settingsId?.());
	const values = $derived(createValues(view, { settings_id: scopedSettingsId }));
	const sealed = settingsVersionSealed(() => record?.settings_id);
	const loan = $derived(collection === 'loan_catalogue');
	/** EMPLOYER and DISPLAY settle no direction: the model keeps it null there. */
	const takesDirection = (destination: unknown): boolean =>
		destination === 'PAY' || destination === 'NET';
	const text = (value: unknown) => (Predicate.isString(value) ? value : '');
</script>

<RecordShell
	of={collection}
	{...record == null ? {} : { id: record.id }}
	mode={view.mode}
	{...sealed()
		? {
				icon: 'lucide:lock-keyhole',
				badge: t('component.settings_sealed_badge'),
				hint: t('component.settings_sealed_note')
			}
		: {}}
>
	<Form
		of={collection}
		mode={view.mode}
		{...record == null ? {} : { id: record.id, record }}
		{values}
		submit={record
			? t('component.save_catalogue_component')
			: t('component.create_catalogue_component')}
		onOutcome={openCreated(view)}
	>
		{#snippet children(form)}
			{#snippet payLine()}
				<Stack gap="sm">
					<p class="text-meta">
						{loan
							? t('component.catalogue_section_pay_line_loan_hint')
							: t('component.catalogue_section_pay_line_hint')}
					</p>
					<Grid gap="md" minimum="card">
						{#if scopedSettingsId == null && record == null}
							<Field name="settings_id" label={t('component.settings_version')}>
								{#snippet editor(field)}
									<Picker
										of="jurisdiction_settings"
										label={['code', 'name']}
										orderBy={{ code: 'asc' }}
										value={text(field.value) || null}
										onChange={field.onChange}
										disabled={field.disabled}
									/>
								{/snippet}
							</Field>
						{/if}
						<Field name="code" label={t('component.code')} />
						<Field name="name" label={t('component.name')} />
						<Field name="destination" label={t('component.destination')}>
							{#snippet editor(field)}
								<!-- EMPLOYER and DISPLAY settle no direction: leaving one clears it. -->
								<Editor
									kind={field.kind}
									value={field.value}
									name={field.name}
									disabled={field.disabled}
									onChange={(next) => {
										field.onChange(next);
										if (!takesDirection(next)) form.set('direction', null);
									}}
								/>
							{/snippet}
						</Field>
						{#if takesDirection(form.get('destination'))}
							<Field name="direction" label={t('component.direction')} />
						{/if}
						{@render payLineFields?.(form)}
					</Grid>
				</Stack>
			{/snippet}

			{#snippet who()}
				<Stack gap="sm">
					<Field
						name="eligibility"
						label={t('component.who_receives')}
						help={t('component.eligibility_hint')}
					>
						{#snippet editor(field)}
							<ExpressionField
								site="person"
								type="boolean"
								value={field.value}
								disabled={field.disabled}
								placeholder={t('component.eligibility_placeholder')}
								onValueChange={field.onChange}
							/>
						{/snippet}
					</Field>
					<ExpressionFields
						site="person"
						expression={text(form.get('eligibility'))}
						type="boolean"
						mode="members"
					/>
				</Stack>
			{/snippet}

			{#snippet limits()}
				<Stack gap="sm">
					<p class="text-meta">
						{collection === 'allowance_catalogue'
							? t('component.allowance_section_pricing_hint')
							: t('component.catalogue_section_limits_hint')}
					</p>
					<Grid gap="md" minimum="card">
						{@render limitFields?.(form)}
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
						help={t('component.counts_toward_hint')}
					>
						{#snippet editor(field)}
							<CountsTowardField
								value={field.value}
								settingsId={(text(form.get('settings_id')) ||
									null) as Id<'jurisdiction_settings'> | null}
								disabled={field.disabled}
								onChange={field.onChange}
							/>
						{/snippet}
					</Field>
				</Stack>
			{/snippet}

			<Tabs
				tabs={[
					{
						name: 'pay_line',
						title: t('component.catalogue_section_pay_line'),
						icon: 'lucide:tag',
						body: payLine,
						keepAlive: true as const
					},
					{
						name: 'who',
						title: loan
							? t('component.catalogue_section_who')
							: t('component.catalogue_section_who_order'),
						icon: 'lucide:users',
						body: who,
						keepAlive: true as const
					},
					{
						name: 'limits',
						title: t('component.catalogue_section_limits'),
						icon: 'lucide:shield',
						body: limits,
						keepAlive: true as const
					},
					{
						name: 'counts_toward',
						title: t('component.catalogue_section_counts_toward'),
						icon: 'lucide:landmark',
						body: countsToward,
						keepAlive: true as const
					}
				].slice(0, loan ? 2 : 4)}
			/>
		{/snippet}
	</Form>
</RecordShell>
