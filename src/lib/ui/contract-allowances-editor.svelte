<script lang="ts">
	/**
	 * The allowances on a contract, as a terms form edits them: one line per allowance class
	 * with its monthly figure, the class chosen from the lineage's allowance catalogue — the
	 * version in force on the terms' first day, or today while the form has no date yet.
	 *
	 * The caller names the lineage (`settingsCode`, the entity's); the value stays the model's
	 * list. A listing names the class row of one version; a later sealed version clones the row
	 * under a new id, so the lineage is read whole and a class is one entry per code however
	 * many versions carry it. A class the person is not eligible for is still offered
	 * here — the run prices nothing for it and says so — because eligibility is the class's
	 * predicate over the person on the pay date, which a form filled today cannot know. The
	 * datatype's own renderer and the change-terms flow both draw this.
	 */
	import { t } from './t.js';
	import { bolt } from '$bolt';
	import { Button, Combobox, Input } from '@norbital-ai/ui';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import { inForceCatalogue } from './create-scope.js';
	import { liveRows } from './live.svelte.js';
	import type { ContractAllowance } from '../datatypes/contract_allowances.js';
	import * as Predicate from 'effect/Predicate';

	let {
		value,
		mode = 'edit',
		disabled = false,
		settingsCode,
		firstDay,
		class: className,
		onValueChange
	}: {
		readonly value: unknown;
		readonly mode?: 'display' | 'edit';
		readonly disabled?: boolean;
		/** The entity's settings lineage, whose allowance classes are offered. */
		readonly settingsCode?: string | undefined;
		/** The terms' first day, which names the version whose classes are offered. */
		readonly firstDay?: string | undefined;
		readonly class?: string;
		readonly onValueChange?: (value: readonly ContractAllowance[]) => void;
	} = $props();
	/** The stored list as given; a malformed entry is dropped rather than drawn. */
	const rows = $derived(
		(Array.isArray(value) ? (value as readonly ContractAllowance[]) : []).filter(
			// repository-health:allow COERCE1 -- a stored allowance amount as Number reads it (a blank or null amount is kept)
			(row) => Predicate.isString(row?.catalogue_id) && Number.isFinite(Number(row.amount))
		)
	);
	/** The classes of the version in force on the terms' first day (today without one). */
	const catalogueRows = liveRows(() =>
		settingsCode == null
			? null
			: bolt.read('allowance_catalogue', {
					where: inForceCatalogue(settingsCode, firstDay) ?? {},
					select: { code: true, name: true },
					orderBy: { code: 'asc' },
					all: true
				})
	);
	/** Every version's rows, so a listing signed under an earlier version still reads by code. */
	const lineageRows = liveRows(() =>
		settingsCode == null
			? null
			: bolt.read('allowance_catalogue', {
					where: { settings_id: { is: { code: { eq: settingsCode } } } },
					select: { code: true, name: true },
					all: true
				})
	);
	const classes = $derived(catalogueRows.current ?? []);
	const lineage = $derived(lineageRows.current ?? []);
	const codeOf = (id: string): string | undefined => lineage.find((row) => row.id === id)?.code;
	const labelOf = (id: string): string => {
		const found = lineage.find((row) => row.id === id);
		return found == null ? id.slice(0, 8) : [found.code, found.name].filter(Boolean).join(' · ');
	};

	function set(next: readonly ContractAllowance[]): void {
		if (mode !== 'edit') return;
		onValueChange?.(next);
	}
	// One entry per code: the first day of a version is also the last of the one before it, and
	// the in-force predicate lists both versions' rows for that day.
	const unlisted = $derived(
		classes.filter(
			(row, index) =>
				!rows.some((r) => codeOf(r.catalogue_id) === row.code) &&
				classes.findIndex((other) => other.code === row.code) === index
		)
	);
</script>

{#if mode === 'display'}
	{#if rows.length === 0}
		<span class={className}>—</span>
	{:else}
		<ul class="text-sm {className ?? ''}">
			{#each rows as row (row.catalogue_id)}
				<li>{labelOf(row.catalogue_id)} · {row.amount}</li>
			{/each}
		</ul>
	{/if}
{:else}
	<Stack gap="xs" class={className}>
		{#if rows.length === 0}
			<p class="text-meta">{t('component.contract_allowances_none')}</p>
		{/if}
		{#each rows as row, index (row.catalogue_id)}
			<Inline gap="sm">
				<Combobox
					class="min-w-0 flex-1"
					options={[
						{ value: row.catalogue_id, label: labelOf(row.catalogue_id) },
						...unlisted.map((option) => ({
							value: option.id,
							label: [option.code, option.name].filter(Boolean).join(' · ')
						}))
					]}
					value={row.catalogue_id}
					{disabled}
					onChange={(next) =>
						next != null &&
						set(rows.map((r, i) => (i === index ? { ...r, catalogue_id: next } : r)))}
				/>
				<Input
					class="w-32"
					type="number"
					min="0"
					step="0.01"
					value={String(row.amount)}
					{disabled}
					onchange={(event) =>
						set(
							rows.map((r, i) =>
								i === index ? { ...r, amount: Number(event.currentTarget.value) || 0 } : r
							)
						)}
				/>
				<Button
					variant="ghost"
					size="sm"
					{disabled}
					onclick={() => set(rows.filter((_, i) => i !== index))}
				>
					{t('component.contract_allowances_remove')}
				</Button>
			</Inline>
		{/each}
		{#if settingsCode == null}
			<p class="text-meta">{t('component.contract_allowances_needs_contract')}</p>
		{:else if unlisted.length > 0}
			<div>
				<Button
					variant="outline"
					size="sm"
					{disabled}
					onclick={() => set([...rows, { catalogue_id: unlisted[0]!.id, amount: 0 }])}
				>
					{t('component.contract_allowances_add')}
				</Button>
			</div>
		{/if}
	</Stack>
{/if}
