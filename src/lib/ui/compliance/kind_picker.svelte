<script lang="ts">
	/**
	 * A workplace case's or work suspension's kind, picked from the catalogue (`case_kinds` rule rows;
	 * `suspension_kind` rows) of the chosen entity's lineage version governing the record's day (today until one is
	 * set); without an entity yet, each lineage's version in force today, grouped by lineage. The collection's
	 * transform judges the kind on save.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Combobox } from '@norbital-ai/ui';
	import { liveRows } from '../state/live.svelte.js';
	import { todayKey } from '../format/calendar.js';
	import { kindsOf } from '../../payroll_engine/listed_kinds.js';

	let {
		source,
		value,
		id,
		companyId = null,
		day = null,
		disabled = false,
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
		onChange: (next: string | null) => void;
	} = $props();

	const entity = liveRows(() =>
		companyId == null
			? null
			: bolt.read('entity', {
					where: { id: { eq: companyId } },
					select: { settings_code: true },
					limit: 1
				})
	);
	const lineage = $derived(entity.current?.[0]?.settings_code ?? null);

	const versions = liveRows(() =>
		bolt.read('jurisdiction_settings', {
			where: { sealed_at: { isNull: false }, voided_at: { isNull: true } },
			select: { id: true, code: true, effective_range: true },
			all: true
		})
	);
	const cases = liveRows(() =>
		source !== 'case'
			? null
			: bolt.read('rule_set', {
					where: { family: { eq: 'PAYROLL' }, code: { eq: 'case_kinds' } },
					select: { settings_id: true, rules: true },
					all: true
				})
	);
	const suspensions = liveRows(() =>
		source !== 'suspension'
			? null
			: bolt.read('suspension_kind', {
					select: { settings_id: true, code: true, name: true },
					all: true
				})
	);
	const options = $derived.by(() => {
		const today = day ?? todayKey();
		const inForce = new Map(
			(versions.current ?? [])
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
				? (suspensions.current ?? []).map((row) => ({
						settings_id: String(row.settings_id),
						code: String(row.code),
						name: String(row.name ?? row.code)
					}))
				: (cases.current ?? []).flatMap((row) =>
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

<Combobox
	{id}
	{options}
	{value}
	{disabled}
	{onChange}
	{...value == null ? {} : { display: value }}
/>
