<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { contributionBandSchema } from './+definition.js';
	import ExpressionFields from '../../lib/ui/expression-fields.svelte';
	import type { RendererProps, Value } from './$types.js';

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(
		Schema.decodeUnknownResult(Schema.Array(contributionBandSchema))(props.value ?? [])
	);
	const rows = $derived(Result.isSuccess(parsed) ? parsed.success : []);
	function emit(value: Value): void {
		if (props.mode === 'edit') props.onValueChange(value);
	}
	function edit(index: number, change: Partial<Value[number]>): void {
		emit(rows.map((row, position) => (position === index ? { ...row, ...change } : row)));
	}
	function remove(index: number): void {
		emit(rows.filter((_row, position) => position !== index));
	}
	function add(): void {
		emit([...rows, { when: 'base > 0.0', employee: '0.0', employer: '0.0' }]);
	}
</script>

{#if props.mode === 'display'}
	<span>{t('component.rate_band_count', { count: rows.length })}</span>
{:else}
	<Stack gap="md">
		<p class="text-sm text-muted-foreground">{t('component.rate_bands_description')}</p>
		{#each rows as row, index (index)}
			<Stack gap="sm" class="border-b border-border pb-3">
				<Grid gap="md" minimum="panel">
					<Stack gap="xs">
						<span class="text-sm font-medium">{t('component.band_eligibility')}</span>
						<Input
							value={row.when}
							{disabled}
							placeholder={'base > 0.0 && base <= 5000.0'}
							oninput={(event) => edit(index, { when: event.currentTarget.value })}
						/>
						<ExpressionFields site="scheme" expression={row.when} type="boolean" />
					</Stack>
					<Stack gap="xs">
						<span class="text-sm font-medium">{t('component.band_employee')}</span>
						<Input
							value={row.employee}
							{disabled}
							placeholder={'base * 11.0 / 100.0'}
							oninput={(event) => edit(index, { employee: event.currentTarget.value })}
						/>
						<ExpressionFields site="scheme" expression={row.employee} type="number" />
					</Stack>
					<Stack gap="xs">
						<span class="text-sm font-medium">{t('component.band_employer')}</span>
						<Input
							value={row.employer}
							{disabled}
							placeholder={'base * 13.0 / 100.0'}
							oninput={(event) => edit(index, { employer: event.currentTarget.value })}
						/>
						<ExpressionFields site="scheme" expression={row.employer} type="number" />
					</Stack>
				</Grid>
				<Button variant="ghost" size="sm" {disabled} onclick={() => remove(index)}>
					{t('component.remove_rate_band')}
				</Button>
			</Stack>
		{/each}
		<Button variant="outline" size="sm" {disabled} onclick={add}>
			{t('component.add_rate_band')}
		</Button>
	</Stack>
{/if}
