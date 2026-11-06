<script lang="ts">
	/**
	 * One settings version: its single fields by what they decide, the global lookup, then the extension schemas folded.
	 */
	import { bolt } from '$bolt';
	import { Field, Form, Section, type FieldEditor, type RecordView } from '@norbital-ai/ui';
	import { Columns, Stack } from '@norbital-ai/ui/layout';
	import LookupSections from './lookup_sections.svelte';

	let { view }: { view: RecordView<'jurisdiction_settings'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

{#snippet lookupView({ value, name }: Pick<FieldEditor, 'value' | 'name'>)}
	<LookupSections {value} {name} />
{/snippet}
{#snippet lookupEditor({ value, name, disabled, onChange }: FieldEditor)}
	<LookupSections {value} {name} {disabled} {onChange} />
{/snippet}

{#if record}<Form of="jurisdiction_settings" mode="update" id={record.id} {record}>
		{#snippet children()}
			<Stack gap="sm">
				<Section first name="settings_version" title={bolt.t('settings_form.version')}>
					<Columns count={2} gap="md">
						<Field name="code" />
						<Field name="name" />
						<Field name="effective_range" />
						<Field name="reason" />
					</Columns>
				</Section>
				<Section name="settings_calendar" title={bolt.t('settings_form.calendar')}>
					<Columns count={2} gap="md">
						<Field name="currency" />
						<Field name="timezone" />
						<Field name="tax_year_start_month" />
					</Columns>
				</Section>
				<Field name="lookup" label="" view={lookupView} editor={lookupEditor} />
				<Section
					name="settings_employee_schema"
					title={bolt.t('settings_form.employee_schema')}
					defaultOpen={false}
				>
					<Field name="employee_extension_schema" />
				</Section>
				<Section
					name="settings_entity_schema"
					title={bolt.t('settings_form.entity_schema')}
					defaultOpen={false}
				>
					<Field name="entity_extension_schema" />
				</Section>
			</Stack>
		{/snippet}
	</Form>{/if}
