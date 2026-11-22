<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Tabs } from '@norbital-ai/ui';
	import type { Law } from '../../../data/model/jurisdiction/service/law.js';
	import type { LawRowTarget } from '../../../lib/ui/settings/law_row.svelte';
	import LawTable from '../../../lib/ui/settings/law_table.svelte';

	let {
		ctx,
		law,
		on_open
	}: {
		ctx: PageContext;
		law: Law;
		on_open: (target: LawRowTarget) => void;
	} = $props();

	const families = [
		'allowance_catalog',
		'overtime_catalog',
		'statutory_contribution_catalog',
		'leave_catalog',
		'claim_catalog',
		'adhoc_catalog',
		'loan_catalog',
		'workplace_case_catalog',
		'work_event_catalog'
	] as const;
	type Family = (typeof families)[number];
	const code = (field: string) => ({ field, as: 'code' }) as const;
	const json = (field: string) => ({ field, as: 'json' }) as const;
	const columns: Record<Family, readonly (string | ReturnType<typeof code | typeof json>)[]> = {
		allowance_catalog: ['code', 'description', code('eligibility'), code('conversion'), 'subtotal'],
		overtime_catalog: [
			'code',
			'description',
			code('eligibility'),
			code('conversion'),
			'subtotal',
			'direction'
		],
		statutory_contribution_catalog: [
			'code',
			'description',
			'kind',
			'depends_on',
			code('employee_amount'),
			code('employer_amount'),
			'subtotal',
			'employer_cost_subtotal'
		],
		leave_catalog: [
			'code',
			'description',
			code('eligibility'),
			code('paid_share'),
			code('payout'),
			'subtotal'
		],
		claim_catalog: ['code', 'description', code('eligibility'), code('conversion'), 'subtotal'],
		adhoc_catalog: [
			'code',
			'description',
			code('eligibility'),
			code('conversion'),
			'subtotal',
			'direction',
			'party'
		],
		loan_catalog: ['code', 'description', code('eligibility'), 'subtotal'],
		workplace_case_catalog: ['code', 'description', json('events'), json('lookup')],
		work_event_catalog: ['code', 'description', json('lookup')]
	};
	let selected = $state<Family>('allowance_catalog');
</script>

{#snippet catalog()}
	{#key selected}
		<LawTable
			{ctx}
			name={selected}
			title={ctx.t(`law_family.${selected}`)}
			description={ctx.t(`law_family_about.${selected}`)}
			rows={law.rows[selected]}
			columns={columns[selected]}
			on_open={(row) => on_open({ family: selected, code: row })}
			on_new={() => on_open({ family: selected, code: null })}
		/>
	{/key}
{/snippet}

<Tabs
	orientation="vertical"
	tabs={families.map((name) => ({ name, title: ctx.t(`law_family.${name}`), body: catalog }))}
	value={selected}
	on_value_change={(next) => {
		selected = families.find((family) => family === next) ?? selected;
	}}
/>
