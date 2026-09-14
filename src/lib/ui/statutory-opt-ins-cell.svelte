<script lang="ts" generics="TRow extends MatrixRow">
	/**
	 * One opt-ins cell for a matrix: the row's `statutory_opt_ins`, compact.
	 *
	 * Editable rows show a popover trigger ("None" or the count) whose content is the same
	 * `StatutoryOptIns` editor used elsewhere; a disabled matrix shows the scheme · effect pairs
	 * inline, because there is nothing to edit.
	 */
	import type { MatrixCellRendererProps, MatrixRow } from '@norbital-ai/ui/data-renderer/matrix';
	import * as Popover from '@norbital-ai/ui/popover';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import StatutoryOptIns from './statutory-opt-ins.svelte';
	import type { StatutoryOptIn } from '../../datatypes/work_rules/+definition.js';

	let { row, disabled, onRowChange }: MatrixCellRendererProps<TRow> = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const value = $derived(
		(((row as Record<string, unknown>).statutory_opt_ins ?? []) as StatutoryOptIn[]).slice()
	);
</script>

{#if disabled}
	<StatutoryOptIns {value} disabled onValueChange={() => {}} />
{:else}
	<Popover.Root>
		<Popover.Trigger
			type="button"
			class="w-fit text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
		>
			{value.length === 0
				? t('renderer.work_rules.opt_ins_none')
				: t('renderer.work_rules.opt_ins_count', { count: value.length })}
		</Popover.Trigger>
		<Popover.Content align="start" sideOffset={6} class="w-[26rem] max-w-[90vw] p-3">
			<StatutoryOptIns {value} onValueChange={(next) => onRowChange({ statutory_opt_ins: next })} />
		</Popover.Content>
	</Popover.Root>
{/if}
