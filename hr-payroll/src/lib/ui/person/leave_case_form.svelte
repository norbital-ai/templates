<script lang="ts">
	/** A birth, an illness or another leave event: the HR controller records what they received, then decides. */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { PlainDate } from '@norbital-ai/std/date';
	import { Combobox, Form, notifyOutcome } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { todayKey } from '../format/calendar.js';

	let {
		contract,
		onDone
	}: {
		contract: {
			readonly id: Id<'employee_contract'>;
			readonly entity_id: Id<'entity'>;
			readonly input_schema_version_id: Id<'jurisdiction_settings'>;
		};
		onDone: () => void;
	} = $props();

	const t = bolt.t;
	const cases = $derived.by(() =>
		bolt.query({
			workplace_case_catalog: {
				where: { settings_id: { eq: contract.input_schema_version_id } },
				fields: ['code', 'name', 'lookup'],
				limit: 200
			}
		})
	);
	const options = $derived(
		(cases?.current?.workplace_case_catalog.rows ?? [])
			.filter((row) => row.lookup.grants != null)
			.map((row) => ({ value: row.id, label: row.name, code: row.code }))
	);
	const decisions = [
		{ value: 'CONFIRMED', label: t('app.leave_case.confirmed') },
		{ value: 'REJECTED', label: t('app.leave_case.rejected') },
		{ value: 'WAITING', label: t('app.leave_case.waiting') }
	];
	let chosen = $state<Id<'workplace_case_catalog'> | null>(null);
	let decision = $state('CONFIRMED');
	const picked = $derived(options.find((row) => row.value === chosen));
</script>

<Stack gap="md">
	<Combobox
		options={options.map(({ value, label }) => ({ value, label }))}
		value={chosen}
		placeholder={t('app.leave_case.kind')}
		aria-label={t('app.leave_case.kind')}
		onChange={(value) => (chosen = value)}
	/>
	<Combobox
		options={decisions}
		value={decision}
		placeholder={t('app.leave_case.decision')}
		aria-label={t('app.leave_case.decision')}
		onChange={(value) => (decision = value ?? 'CONFIRMED')}
	/>
	{#if picked !== undefined}
		{#key `${picked.value}-${decision}`}
			<Form
				of="workplace_case_catalog_entry"
				mode="create"
				values={{
					entity_id: contract.entity_id,
					catalog_id: picked.value,
					kind: picked.code,
					opened_on: PlainDate(todayKey()),
					inputs: { employment_id: contract.id, ...(decision === 'WAITING' ? {} : { decision }) }
				}}
				fields={['opened_on', 'evidence_file']}
				onOutcome={(outcome) => {
					notifyOutcome(bolt, outcome);
					onDone();
				}}
			/>
		{/key}
	{/if}
</Stack>
