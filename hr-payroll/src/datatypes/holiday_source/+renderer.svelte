<script lang="ts">
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import type { RendererProps, Value } from './$types.js';

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const current = $derived<Value>(props.value ?? { calendar_id: '', time_zone: '', enabled: true });
	function edit(change: Partial<Value>): void {
		if (props.mode === 'edit') props.onValueChange({ ...current, ...change });
	}
</script>

{#if props.mode === 'display'}
	<span
		>{props.value == null
			? '—'
			: `${props.value.calendar_id} · ${props.value.time_zone}${props.value.enabled ? '' : ` · ${t('holiday_source.disabled')}`}`}</span
	>
{:else}
	<Stack gap="sm">
		<p class="text-sm text-muted-foreground">{t('holiday_source.description')}</p>
		<Grid gap="sm" minimum="compact">
			<label class="text-sm"
				><Stack gap="xs"
					>{t('holiday_source.calendar_id')}<Input
						value={current.calendar_id}
						{disabled}
						data-holiday-source="calendar_id"
						oninput={(event) => edit({ calendar_id: event.currentTarget.value })}
					/></Stack
				></label
			>
			<label class="text-sm"
				><Stack gap="xs"
					>{t('holiday_source.time_zone')}<Input
						value={current.time_zone}
						{disabled}
						data-holiday-source="time_zone"
						oninput={(event) => edit({ time_zone: event.currentTarget.value })}
					/></Stack
				></label
			>
			<label class="flex items-center gap-2 text-sm"
				><input
					type="checkbox"
					checked={current.enabled}
					{disabled}
					data-holiday-source="enabled"
					onchange={(event) => edit({ enabled: event.currentTarget.checked })}
				/>{t('holiday_source.enabled')}</label
			>
		</Grid>
	</Stack>
{/if}
