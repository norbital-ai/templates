<script lang="ts">
	/**
	 * One row of a settings version's leave catalogue. A statutory row cites its authority and its
	 * eligibility is one CEL expression over the person, which the transform compiles. Sealed with
	 * its version.
	 *
	 * Segments are tabs (kept mounted), so one panel is on screen at a time and its fields spread
	 * across the sheet. `settings_id` is never a field on the Settings page: the page names the
	 * version and the form prefills it. Opened without that scope it keeps a version picker.
	 */
	import { t } from '../../../lib/ui/t.js';
	import { Field, Form } from '@norbital-ai/ui';
	import { Picker } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { Tabs } from '@norbital-ai/ui';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import ExpressionFields from '../../../lib/ui/expression-fields.svelte';
	import ExpressionField from '../../../lib/ui/expression-field.svelte';
	import { createValues, hrCreateScope } from '../../../lib/ui/create-scope.js';
	import { openCreated } from '../../../lib/ui/open-created.js';
	import { settingsVersionSealed } from '../../../lib/ui/settings-sealed.svelte.js';
	import * as Predicate from 'effect/Predicate';

	let { view }: { view: RecordView<'leave_catalogue'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const scopedSettingsId = $derived(hrCreateScope()?.settingsId?.());
	const values = $derived(createValues(view, { settings_id: scopedSettingsId }));
	const sealed = settingsVersionSealed(() => record?.settings_id);
	const text = (value: unknown) => (Predicate.isString(value) ? value : '');
</script>

<RecordShell
	of="leave_catalogue"
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
		of="leave_catalogue"
		mode={view.mode}
		{...record == null ? {} : { id: record.id, record }}
		{values}
		submit={record ? t('component.save_catalogue_leave') : t('component.create_catalogue_leave')}
		onOutcome={openCreated(view)}
	>
		{#snippet children(form)}
			{#snippet identity()}
				<Stack gap="sm">
					<p class="text-meta">{t('component.leave_section_identity_hint')}</p>
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
						<Field name="authority" label={t('component.authority')} />
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

			{#snippet entitlement()}
				<Stack gap="sm">
					<p class="text-meta">{t('component.leave_section_entitlement_hint')}</p>
					<Field name="entitlement" label={t('component.entitlement_matrix')} />
				</Stack>
			{/snippet}

			{#snippet pay()}
				<Stack gap="sm">
					<p class="text-meta">{t('component.leave_section_pay_hint')}</p>
					<Grid gap="md" minimum="card">
						<Field name="is_npl" label={t('component.is_npl')} />
						<Field name="can_encash" label={t('component.can_encash')} />
						<Field
							name="encash_on_exit"
							label={t('component.encash_on_exit')}
							help={t('component.encash_on_exit_hint')}
						/>
						<Field name="paid_by" label={t('component.paid_by')} />
						<Field name="unit" label={t('component.leave_unit')} />
						<Field name="consumes_code" label={t('component.consumes_code')} />
						<Field name="pay_fraction" label={t('component.pay_fraction')}>
							{#snippet editor(field)}
								<ExpressionField
									site="leave_day"
									type="number"
									value={field.value}
									disabled={field.disabled}
									placeholder="leave.month_index <= 4 ? 1.0 : 0.75"
									onValueChange={field.onChange}
								/>
							{/snippet}
						</Field>
						<Field name="evidence" label={t('component.evidence')} />
						<Field
							name="evidence_after_days"
							label={t('component.certificate_required_after_days')}
						/>
					</Grid>
				</Stack>
			{/snippet}

			<Tabs
				tabs={[
					{
						name: 'identity',
						title: t('component.leave_section_identity'),
						icon: 'lucide:tag',
						body: identity,
						keepAlive: true
					},
					{
						name: 'who',
						title: t('component.who_may_take_it'),
						icon: 'lucide:users',
						body: who,
						keepAlive: true
					},
					{
						name: 'entitlement',
						title: t('component.leave_section_entitlement'),
						icon: 'lucide:calendar-days',
						body: entitlement,
						keepAlive: true
					},
					{
						name: 'pay',
						title: t('component.leave_section_pay'),
						icon: 'lucide:circle-dollar-sign',
						body: pay,
						keepAlive: true
					}
				]}
			/>
		{/snippet}
	</Form>
</RecordShell>
