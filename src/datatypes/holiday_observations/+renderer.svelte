<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import { holidayObservationInputSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(
		Schema.decodeUnknownResult(Schema.Array(holidayObservationInputSchema))(props.value ?? [])
	);
	const rows = $derived(Result.isSuccess(parsed) ? parsed.success : []);
	function emit(value: Value): void {
		if (props.mode === 'edit') props.onValueChange(value);
	}
	function edit(index: number, change: Partial<Value[number]>): void {
		emit(rows.map((row, position) => (position === index ? { ...row, ...change } : row)));
	}
</script>

{#if props.mode === 'display'}
	<span>{t('holiday_calendar.observation_count', { count: rows.length })}</span>
{:else}
	<Stack gap="md">
		<p class="text-sm text-muted-foreground">{t('holiday_calendar.complete_list_hint')}</p>
		{#each rows as row, index (index)}
			<Stack gap="sm" class="border-b border-border pb-3">
				<Grid gap="sm" minimum="compact">
					<label class="text-sm"
						><Stack gap="xs"
							>{t('component.observed_on')}<Input
								type="date"
								value={row.date}
								{disabled}
								oninput={(event) => edit(index, { date: event.currentTarget.value })}
							/></Stack
						></label
					>
					<label class="text-sm"
						><Stack gap="xs"
							>{t('component.holiday')}<Input
								value={row.name}
								{disabled}
								oninput={(event) => edit(index, { name: event.currentTarget.value })}
							/></Stack
						></label
					>
					<label class="text-sm"
						><Stack gap="xs"
							>{t('holiday_calendar.original_date')}<Input
								type="date"
								value={row.original_date ?? ''}
								{disabled}
								oninput={(event) =>
									edit(index, { original_date: event.currentTarget.value || null })}
							/></Stack
						></label
					>
					<label class="text-sm"
						><Stack gap="xs"
							>{t('holiday_calendar.source')}<Input
								value={row.source ?? ''}
								{disabled}
								oninput={(event) => edit(index, { source: event.currentTarget.value || null })}
							/></Stack
						></label
					>
				</Grid>
				<Cluster
					><Button
						variant="ghost"
						size="sm"
						{disabled}
						onclick={() => emit(rows.filter((_, position) => position !== index))}
						>{t('holiday_calendar.remove')}</Button
					></Cluster
				>
			</Stack>
		{/each}
		<Cluster
			><Button
				variant="outline"
				size="sm"
				{disabled}
				onclick={() => emit([...rows, { date: '', name: '', original_date: null, source: null }])}
				>{t('holiday_calendar.add')}</Button
			></Cluster
		>
	</Stack>
{/if}
