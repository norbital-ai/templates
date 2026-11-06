<script lang="ts">
	import type { Id } from '@norbital-ai/bolt';
	import { highlightedLine, Table, Tabs } from '@norbital-ai/ui';

	let {
		versionId,
		draft
	}: {
		versionId: Id<'jurisdiction_settings'>;
		draft: boolean;
	} = $props();

	const families = [
		'allowance_catalog',
		'overtime_catalog',
		'statutory_contribution_catalog',
		'leave_catalog',
		'claim_catalog',
		'adhoc_catalog',
		'loan_catalog',
		'work_interruption_catalog',
		'workplace_case_catalog'
	] as const;
	const labels: Record<(typeof families)[number], string> = {
		allowance_catalog: 'Allowances',
		overtime_catalog: 'Overtime and work',
		statutory_contribution_catalog: 'Statutory contributions',
		leave_catalog: 'Leave',
		claim_catalog: 'Claims',
		adhoc_catalog: 'Ad hoc',
		loan_catalog: 'Loans',
		work_interruption_catalog: 'Work interruptions',
		workplace_case_catalog: 'Workplace cases'
	};
	let selected = $state<(typeof families)[number]>('allowance_catalog');
	const firstLine = (value: unknown): string =>
		String(value ?? '')
			.split('\n')
			.map((line) => line.trim())
			.find((line) => line !== '' && line !== '// js' && !line.startsWith('//')) ?? '';
</script>

{#snippet codeCell({ value }: { value: unknown })}
	<code
		class="bg-muted block max-w-[18rem] truncate rounded-sm px-1.5 py-0.5 font-mono text-xs"
		data-cel
		>{#each highlightedLine(firstLine(value)) as token, i (i)}<span class={token.class || undefined}
				>{token.text}</span
			>{/each}</code
	>
{/snippet}

{#snippet jsonCell({ value }: { value: unknown })}
	<span class="block max-w-[18rem] truncate font-mono text-xs text-muted-foreground"
		>{firstLine(JSON.stringify(value ?? {}))}</span
	>
{/snippet}

{#snippet catalog()}
	<section class="min-w-0">
		{#if selected === 'allowance_catalog'}<Table
				of="allowance_catalog"
				key="allowance_catalog"
				where={{ settings_id: { eq: versionId } }}
				toolbar={{ new: draft, title: labels.allowance_catalog }}
				columns={[
					'code',
					'name',
					{ field: 'eligibility', cell: codeCell },
					{ field: 'conversion', cell: codeCell },
					'subtotal_id',
					'direction',
					'party',
					'off_cycle_eligible',
					'prorate'
				]}
			/>
		{:else if selected === 'overtime_catalog'}<Table
				of="overtime_catalog"
				key="overtime_catalog"
				where={{ settings_id: { eq: versionId } }}
				toolbar={{ new: draft, title: labels.overtime_catalog }}
				columns={[
					'code',
					'name',
					{ field: 'eligibility', cell: codeCell },
					{ field: 'conversion', cell: codeCell },
					'subtotal_id',
					'direction',
					'party',
					'off_cycle_eligible'
				]}
			/>
		{:else if selected === 'statutory_contribution_catalog'}<Table
				of="statutory_contribution_catalog"
				key="statutory_contribution_catalog"
				where={{ settings_id: { eq: versionId } }}
				toolbar={{ new: draft, title: labels.statutory_contribution_catalog }}
				columns={[
					'code',
					'name',
					'kind',
					'depends_on',
					{ field: 'employee_amount', cell: codeCell },
					{ field: 'employer_amount', cell: codeCell },
					'subtotal_id',
					'employer_cost_subtotal_id',
					'off_cycle_eligible'
				]}
			/>
		{:else if selected === 'leave_catalog'}<Table
				of="leave_catalog"
				key="leave_catalog"
				where={{ settings_id: { eq: versionId } }}
				toolbar={{ new: draft, title: labels.leave_catalog }}
				columns={[
					'code',
					'name',
					'pay_treatment',
					{ field: 'eligibility', cell: codeCell },
					{ field: 'conversion', cell: codeCell },
					'subtotal_id',
					'off_cycle_eligible'
				]}
			/>
		{:else if selected === 'claim_catalog'}<Table
				of="claim_catalog"
				key="claim_catalog"
				where={{ settings_id: { eq: versionId } }}
				toolbar={{ new: draft, title: labels.claim_catalog }}
				columns={[
					'code',
					'name',
					{ field: 'eligibility', cell: codeCell },
					{ field: 'conversion', cell: codeCell },
					'subtotal_id',
					'direction',
					'party',
					'off_cycle_eligible'
				]}
			/>
		{:else if selected === 'adhoc_catalog'}<Table
				of="adhoc_catalog"
				key="adhoc_catalog"
				where={{ settings_id: { eq: versionId } }}
				toolbar={{ new: draft, title: labels.adhoc_catalog }}
				columns={[
					'code',
					'name',
					{ field: 'eligibility', cell: codeCell },
					{ field: 'conversion', cell: codeCell },
					'subtotal_id',
					'direction',
					'party',
					'off_cycle_eligible'
				]}
			/>
		{:else if selected === 'loan_catalog'}<Table
				of="loan_catalog"
				key="loan_catalog"
				where={{ settings_id: { eq: versionId } }}
				toolbar={{ new: draft, title: labels.loan_catalog }}
				columns={[
					'code',
					'name',
					{ field: 'eligibility', cell: codeCell },
					{ field: 'conversion', cell: codeCell },
					'subtotal_id',
					'direction',
					'party',
					'off_cycle_eligible'
				]}
			/>
		{:else if selected === 'work_interruption_catalog'}<Table
				of="work_interruption_catalog"
				key="work_interruption_catalog"
				where={{ settings_id: { eq: versionId } }}
				toolbar={{ new: draft, title: labels.work_interruption_catalog }}
				columns={[
					'code',
					'name',
					'events',
					{ field: 'lookup', cell: jsonCell },
					'off_cycle_eligible'
				]}
			/>
		{:else}<Table
				of="workplace_case_catalog"
				key="workplace_case_catalog"
				where={{ settings_id: { eq: versionId } }}
				toolbar={{ new: draft, title: labels.workplace_case_catalog }}
				columns={[
					'code',
					'name',
					'events',
					{ field: 'lookup', cell: jsonCell },
					'off_cycle_eligible'
				]}
			/>{/if}
	</section>
{/snippet}

<Tabs
	orientation="vertical"
	class="min-h-[34rem]"
	tabs={families.map((name) => ({ name, title: labels[name], body: catalog }))}
	value={selected}
	onValueChange={(next) => {
		selected = families.find((family) => family === next) ?? selected;
	}}
/>
