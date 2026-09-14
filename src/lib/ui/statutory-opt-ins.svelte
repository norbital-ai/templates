<script lang="ts">
	/**
	 * The explicit statutory opt-ins of one line or band (RFC 0001 §4, §9): which schemes the
	 * amount is included in or reduces, by scheme, with silence meaning no effect.
	 *
	 * The schemes are the settings version's own rows, read live and picked by code — never a
	 * hand-typed UUID. The query is opened in every mode so a sealed version can still name the
	 * schemes it refers to; a disabled surface shows the pairs as compact text, never as empty
	 * pickers.
	 *
	 * Both callers are band editors (a catalogue band and a work band), so this component owns the
	 * one shape rather than each renderer reimplementing the same two dropdowns.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import type { StatutoryOptIn } from '../../datatypes/work_rules/+definition.js';
	import { statutorySchemeOptions } from './scheme-options.svelte.js';

	type Props = {
		readonly value: readonly StatutoryOptIn[];
		readonly disabled?: boolean;
		readonly onValueChange: (value: StatutoryOptIn[]) => void;
	};

	let { value, disabled = false, onValueChange }: Props = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const schemes = statutorySchemeOptions();
	const schemeOptions = $derived(schemes.options);
	const effectOptions = $derived([
		{ value: 'INCLUDE' as const, label: t('component.opt_in_include') },
		{ value: 'REDUCE' as const, label: t('component.opt_in_reduce') }
	]);
	const effectLabel = (effect: StatutoryOptIn['effect']): string =>
		effect === 'REDUCE' ? t('component.opt_in_reduce') : t('component.opt_in_include');
	/** One line for a matrix cell; the pairs beyond the cell's width are in the title. */
	const readOnlyText = (rows: readonly StatutoryOptIn[]): string =>
		rows
			.map((row) => `${schemes.codeOf(row.contribution_id)} · ${effectLabel(row.effect)}`)
			.join('   ');

	function edit(index: number, change: Partial<StatutoryOptIn>): void {
		onValueChange(value.map((row, position) => (position === index ? { ...row, ...change } : row)));
	}
</script>

{#if disabled}
	{@render readOnly()}
{:else}
	<div class="flex flex-col gap-1">
		{#each value as row, index (index)}
			<div class="grid grid-cols-[minmax(9rem,1fr)_minmax(7rem,0.5fr)_auto] items-center gap-2">
				<Combobox
					ariaLabel={t('component.statutory_scheme')}
					options={schemeOptions}
					value={row.contribution_id === '' ? null : row.contribution_id}
					{disabled}
					emptyPlaceholder={t('component.choose_scheme')}
					onValueChange={(contribution_id) =>
						edit(index, { contribution_id: contribution_id ?? '' })}
				/>
				<Combobox
					ariaLabel={t('component.opt_in_effect')}
					options={effectOptions}
					value={row.effect}
					{disabled}
					searchable={false}
					onValueChange={(effect) => {
						if (effect) edit(index, { effect });
					}}
				/>
				<Button
					variant="ghost"
					size="sm"
					{disabled}
					onclick={() => onValueChange(value.filter((_row, position) => position !== index))}
				>
					{t('component.remove')}
				</Button>
			</div>
		{/each}
		<Button
			variant="outline"
			size="sm"
			{disabled}
			class="w-fit"
			onclick={() => onValueChange([...value, { contribution_id: '', effect: 'INCLUDE' }])}
		>
			{t('component.add_opt_in')}
		</Button>
	</div>
{/if}

{#snippet readOnly()}
	{#if value.length === 0}
		<span class="text-meta">—</span>
	{:else}
		<span class="block truncate text-sm" title={readOnlyText(value)}>{readOnlyText(value)}</span>
	{/if}
{/snippet}
