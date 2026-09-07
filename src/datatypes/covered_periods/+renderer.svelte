<script lang="ts">
	/**
	 * The past pay periods an arrears settlement makes good, one `YYYY-MM` per row.
	 *
	 * A list of months rather than a relation, because the periods named here may have no run, no
	 * payslip and no row anywhere — arrears for a month the company had not yet onboarded is the
	 * ordinary case. So there is nothing to pick from, and the control is a native month picker per
	 * entry with an add and a remove, exactly as `leave_entitlement` edits its layers.
	 *
	 * Its predecessor was a single comma-separated text field inside a five-armed union, which
	 * dropped anything that did not match `YYYY-MM` **silently** as you typed: a half-typed `2026-1`
	 * simply vanished from the value. A month input cannot emit a malformed month, so the filtering
	 * step that hid the mistake is gone with it.
	 *
	 * The stored list must hold at least one period, which the schema states and the database keeps.
	 * That is not restated here: this control lets the operator empty the list, and the form refuses
	 * the write, because a control that will not let you delete the last row is a control you cannot
	 * correct a typo in.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { IconWrapper } from '@norbital-ai/ui/icon-wrapper';
	import type { RendererProps } from './$types.js';

	const { t } = useI18n<TenantI18nKeys>();

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const periods = $derived<string[]>([...(props.value ?? [])]);
	const summary = $derived(periods.length === 0 ? '—' : periods.join(', '));

	function emit(next: string[]): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="sm" class="rounded-md border border-border bg-muted/20 p-3">
		{#if periods.length === 0}
			<p class="text-sm text-muted-foreground">{t('renderer.covered_periods.empty')}</p>
		{/if}
		{#each periods as period, index (index)}
			<Cluster gap="xs" align="center">
				<Input
					type="month"
					class="max-w-48"
					value={period}
					{disabled}
					aria-label={t('component.pay_period')}
					oninput={(event) => {
						const next = [...periods];
						next[index] = event.currentTarget.value;
						emit(next);
					}}
				/>
				<Button
					variant="ghost"
					size="icon"
					{disabled}
					aria-label={t('renderer.covered_periods.remove')}
					onclick={() => emit(periods.filter((_, candidate) => candidate !== index))}
				>
					<IconWrapper name="lucide:x" class="size-3.5" />
				</Button>
			</Cluster>
		{/each}
		<Cluster gap="xs">
			<Button
				variant="outline"
				size="sm"
				{disabled}
				onclick={() => emit([...periods, new Date().toISOString().slice(0, 7)])}
			>
				{t('renderer.covered_periods.add')}
			</Button>
		</Cluster>
	</Stack>
{/if}
