<script lang="ts">
	/** One settings version: its declared form sections. Arbitrary lookup tables live in their own tab. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, Form, Section, type RecordView } from '@norbital-ai/ui';
	import { Columns, Stack } from '@norbital-ai/ui/layout';

	let { ctx, view }: { ctx: PageContext; view: RecordView<'jurisdiction_settings'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
</script>

{#if record}<Form {ctx} of="jurisdiction_settings" mode="update" id={record.id} {record}>
		{#snippet children()}
			<Stack gap="sm">
				<Section first name="settings_version" title={ctx.t('settings_form.version')}>
					<Columns count={2} gap="md">
						<Field {ctx} name="code" />
						<Field {ctx} name="name" />
						<Field {ctx} name="effective_range" />
						<Field {ctx} name="reason" />
					</Columns>
				</Section>
				<Section name="settings_calendar" title={ctx.t('settings_form.calendar')}>
					<Columns count={2} gap="md">
						<Field {ctx} name="currency" />
						<Field {ctx} name="timezone" />
						<Field {ctx} name="tax_year_start_month" />
					</Columns>
				</Section>
				<Section
					name="settings_employee_schema"
					title={ctx.t('settings_form.employee_schema')}
					default_open={false}
				>
					<Field {ctx} name="employee_extension_schema" />
				</Section>
				<Section
					name="settings_entity_schema"
					title={ctx.t('settings_form.entity_schema')}
					default_open={false}
				>
					<Field {ctx} name="entity_extension_schema" />
				</Section>
			</Stack>
		{/snippet}
	</Form>{/if}
