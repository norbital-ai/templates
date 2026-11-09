<script lang="ts">
	import { bolt } from '$bolt';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';

	const valueCell = ({ value }: { value: unknown }) =>
		typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2);
</script>

{#snippet codeCell({ value }: { value: unknown })}
	<code
		class="block max-w-[22rem] whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground"
		>{valueCell({ value })}</code
	>
{/snippet}

<AppShell
	title={bolt.t('app.settings.change_log')}
	description={bolt.t('app.settings.change_log_description')}
	icon="lucide:history"
>
	<Stack gap="lg">
		<Table
			of="statutory_change"
			key="statutory_change_log"
			toolbar={{ new: false, title: bolt.t('app.settings.change_log') }}
			columns={[
				'jurisdiction_code',
				'family',
				'row_code',
				'field_path',
				{ field: 'old_value', cell: codeCell },
				{ field: 'new_value', cell: codeCell },
				'effective_from',
				'applied_version_id',
				'finding_id'
			]}
		/>
	</Stack>
</AppShell>
