<script lang="ts" generics="TRow extends MatrixRow">
	/**
	 * One roster-code cell for a matrix: the codes of the row's company, by code and name. The
	 * company rides the matrix row (`company_id`), so the same cell serves every day of a pattern.
	 */
	import { t } from './t.js';
	import type { MatrixCellRendererProps, MatrixRow } from './grid.svelte';
	import type { Id } from '@norbital-ai/bolt';
	import { bolt } from '$bolt';
	import { Combobox } from '@norbital-ai/ui';
	import { liveRows } from './live.svelte.js';
	import * as Predicate from 'effect/Predicate';

	let { value, row, disabled, placeholder, onValueChange }: MatrixCellRendererProps<TRow> =
		$props();
	// The matrix row is a draft of the list value: its entity is asserted here, where it enters.
	const companyId = $derived(
		Predicate.isString(row.company_id) ? (row.company_id as Id<'companies'>) : null
	);
	const codes = liveRows(() =>
		companyId == null
			? null
			: bolt.read('shift_definitions', {
					where: { company_id: { eq: companyId }, approval_id: { isNull: true } },
					select: { code: true, name: true },
					orderBy: { code: 'asc' },
					all: true
				})
	);
</script>

<Combobox
	class="w-full min-w-0"
	size="sm"
	aria-label={t('component.code')}
	placeholder={placeholder ?? t('roster.choose_roster_code')}
	clearable
	options={(codes.current ?? []).map((code) => ({
		value: code.id,
		label: `${code.code} · ${code.name}`
	}))}
	value={typeof value === 'string' && value !== '' ? value : null}
	{disabled}
	onChange={(next) => onValueChange(next ?? '')}
/>
