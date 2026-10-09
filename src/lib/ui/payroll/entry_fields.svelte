<script lang="ts">
	/**
	 * A captured entry's fields (inside its `Form`): the person from the opening page's entity only, and the class from
	 * the catalogue of the employment's lineage version governing the entry day, not every lineage's identical "Bonus".
	 * Opened from no scoped page (self-service), the person is not narrowed; the class still follows the employment. A
	 * leave class is narrowed further to those the employee is eligible for (the balances the server lists).
	 */
	import * as Predicate from 'effect/Predicate';
	import { PlainDate } from '@norbital-ai/std/date';
	import { Field, Picker, type FormState } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { pageEntity } from '../scopes/company_scope.svelte.js';
	import { live, liveRows } from '../state/live.svelte.js';
	import { todayKey } from '../format/calendar.js';

	let {
		catalog,
		form,
		fields
	}: {
		catalog: 'adhoc_catalog' | 'claim_catalog' | 'leave_catalog' | 'loan_catalog';
		form: FormState;
		fields: readonly string[];
	} = $props();

	const page = pageEntity();
	const employmentId = $derived.by(() => {
		const held = form.get('employment_id');
		// the form holds the picked id as text; it is a row id of `employment_contract`
		return Predicate.isString(held) && held !== '' ? (held as Id<'employment_contract'>) : null;
	});
	const employment = liveRows(() => {
		const id = employmentId;
		return id == null
			? null
			: bolt.read('employment_contract', {
					where: { id: { eq: id } },
					select: { company_id: { select: { settings_code: true } } },
					limit: 1
				});
	});
	const lineage = $derived(
		employment.current?.[0]?.company_id?.settings_code ?? page?.company?.settings_code ?? null
	);
	const day = $derived.by(() => {
		const held = form.get('occurred_on');
		return Predicate.isString(held) && held !== '' ? held : todayKey();
	});
	/** The leave classes the employee may take on the day: the server's listing, eligibility applied. */
	const balances = live(
		() =>
			catalog !== 'leave_catalog' || employmentId == null
				? null
				: bolt.query('leave_catalog_entry.leave_balances', {
						employment_id: employmentId,
						as_of: PlainDate(day)
					}),
		['employment_contract', 'leave_catalog_entry']
	);
	const eligible = $derived(
		balances.current == null
			? {}
			: { id: { in: [...new Set(balances.current.balances.map((row) => row.catalog_id))] } }
	);
	const governs = $derived({
		sealed_at: { isNull: false },
		voided_at: { isNull: true },
		effective_range: { contains: PlainDate(day) },
		...(lineage == null ? {} : { code: { eq: lineage } })
	} as const);
</script>

<Grid minimum="card">
	<Field name="employment_id">
		{#snippet editor(field)}
			<Picker
				of="employment_contract"
				id={field.id}
				where={page?.id == null ? {} : { company_id: { eq: page.id } }}
				value={Predicate.isString(field.value) ? field.value : null}
				disabled={field.disabled}
				onChange={field.onChange}
			/>
		{/snippet}
	</Field>
	<Field name="catalog_id">
		{#snippet editor(field)}
			{#if catalog === 'adhoc_catalog'}
				<Picker
					of="adhoc_catalog"
					id={field.id}
					where={{ approval_id: { isNull: true }, settings_id: { is: governs } }}
					value={Predicate.isString(field.value) ? field.value : null}
					disabled={field.disabled}
					onChange={field.onChange}
				/>
			{:else if catalog === 'leave_catalog'}
				<Picker
					of="leave_catalog"
					id={field.id}
					where={{ approval_id: { isNull: true }, settings_id: { is: governs }, ...eligible }}
					value={Predicate.isString(field.value) ? field.value : null}
					disabled={field.disabled}
					onChange={field.onChange}
				/>
			{:else if catalog === 'claim_catalog'}
				<Picker
					of="claim_catalog"
					id={field.id}
					where={{ approval_id: { isNull: true }, settings_id: { is: governs } }}
					value={Predicate.isString(field.value) ? field.value : null}
					disabled={field.disabled}
					onChange={field.onChange}
				/>
			{:else}
				<Picker
					of="loan_catalog"
					id={field.id}
					where={{ approval_id: { isNull: true }, settings_id: { is: governs } }}
					value={Predicate.isString(field.value) ? field.value : null}
					disabled={field.disabled}
					onChange={field.onChange}
				/>
			{/if}
		{/snippet}
	</Field>
	{#each fields as name (name)}
		<Field {name} />
	{/each}
</Grid>
