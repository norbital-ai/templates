<script lang="ts">
	/** L-TPL-hr-payroll-094: monthly allowance lines on a contract's terms, prorated with salary. */
	import { Button, Input } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import type { Schema } from 'effect';
	import { t } from '../i18n/t.js';

	let {
		lines = $bindable(),
		disabled = false
	}: {
		/** `source` is the stored line an edit came from; its other keys are kept. */
		lines: { code: string; amount: string; source?: Schema.Json }[];
		disabled?: boolean;
	} = $props();

	function add(): void {
		lines = [...lines, { code: '', amount: '' }];
	}

	function remove(index: number): void {
		lines = lines.filter((_, i) => i !== index);
	}
</script>

<Stack gap="xs">
	<span class="text-xs font-medium text-muted-foreground">{t('component.allowances')}</span>
	<p class="text-xs text-muted-foreground">{t('component.allowances_hint')}</p>
	{#each lines as line, index (index)}
		<Cluster gap="sm">
			<Input
				aria-label={t('component.allowances')}
				value={line.code}
				{disabled}
				onchange={(event: Event & { currentTarget: HTMLInputElement }) => {
					lines = lines.map((row, i) =>
						i === index ? { ...row, code: event.currentTarget.value } : row
					);
				}}
			/>
			<Input
				type="number"
				aria-label={t('component.allowance_amount')}
				value={line.amount}
				{disabled}
				onchange={(event: Event & { currentTarget: HTMLInputElement }) => {
					lines = lines.map((row, i) =>
						i === index ? { ...row, amount: event.currentTarget.value } : row
					);
				}}
			/>
			<Button size="sm" variant="outline" {disabled} onclick={() => remove(index)}>
				{t('component.contract_allowances_remove')}
			</Button>
		</Cluster>
	{/each}
	<Button size="sm" variant="outline" {disabled} onclick={add}>
		{t('component.contract_allowances_add')}
	</Button>
</Stack>
