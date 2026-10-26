<script lang="ts">
	/**
	 * A workplace case's or work suspension's kind, picked from the catalogue (`case_kinds` rule rows;
	 * the version’s inline suspension kinds) of the chosen entity's lineage version governing the record's day (today until one is
	 * set); without an entity yet, each lineage's version in force today, grouped by lineage. The collection's
	 * transform judges the kind on save. Readonly, the kind reads as its name.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Combobox } from '@norbital-ai/ui';
	import { todayKey } from '../format/calendar.js';
	import { kindsOf } from '../../payroll_engine/listed_kinds.js';

	let {
		source,
		value,
		id,
		companyId = null,
		day = null,
		disabled = false,
		readonly = false,
		onChange
	}: {
		source: 'case' | 'suspension';
		value: string | null;
		id: string;
		/** The record's entity: only its lineage's kinds. */
		companyId?: Id<'entity'> | null;
		/** The record's own day (opened, starts): the version governing it. */
		day?: string | null;
		disabled?: boolean;
		readonly?: boolean;
		onChange: (next: string | null) => void;
	} = $props();

	const entity = $derived.by(() =>
		companyId == null
			? null
			: bolt.query('entity', {
					where: { id: { eq: companyId } },
					select: { settings_code: true },
					limit: 1
				})
	);
	const lineage = $derived(entity?.current?.rows?.[0]?.settings_code ?? null);

	const versions = $derived.by(() =>
		bolt.query('jurisdiction_settings', {
			where: { sealed_at: { isNull: false }, voided_at: { isNull: true } },
			select: { id: true, code: true, effective_range: true, suspension_kinds: true },
			all: true
		})
	);
	const cases = $derived.by(() =>
		source !== 'case'
			? null
			: bolt.query('rule_set', {
					where: { family: { eq: 'PAYROLL' }, code: { eq: 'case_kinds' } },
					select: { settings_id: true, rules: true },
					all: true
				})
	);
	const options = $derived.by(() => {
		const today = day ?? todayKey();
		const inForce = new Map(
			(versions?.current?.rows ?? [])
				.filter((row) => lineage == null || row.code === lineage)
				.filter((row) => {
					const from = String(row.effective_range?.from ?? '');
					const to = row.effective_range?.to == null ? null : String(row.effective_range.to);
					return from <= today && (to == null || to >= today);
				})
				.map((row) => [String(row.id), String(row.code)])
		);
		const kinds: { settings_id: string; code: string; name: string }[] =
			source === 'suspension'
				? (versions?.current?.rows ?? []).flatMap((version) =>
						(version.suspension_kinds ?? []).map((kind) => ({
							settings_id: String(version.id),
							code: kind.code,
							name: kind.name ?? kind.code
						}))
					)
				: (cases?.current?.rows ?? []).flatMap((row) =>
						kindsOf(row.rules).map((kind) => ({ settings_id: String(row.settings_id), ...kind }))
					);
		return kinds
			.filter((kind) => inForce.has(kind.settings_id))
			.map((kind) => ({
				value: kind.code,
				label: kind.name,
				description: kind.code,
				group: inForce.get(kind.settings_id)!
			}));
	});
</script>

{#if readonly}
	<p class="text-sm font-medium">
		{value == null ? '—' : (options.find((option) => option.value === value)?.label ?? value)}
	</p>
{:else}
	<Combobox
		{id}
		{options}
		{value}
		{disabled}
		{onChange}
		{...value == null ? {} : { display: value }}
	/>
{/if}
