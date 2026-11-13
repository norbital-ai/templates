<script lang="ts" module>
	import type { Kind } from '@norbital-ai/ui';
	import type { LawFamily } from '../../law.js';

	/** How a field is edited: by its kind, as an expression, or as the code of a subtotal of the same law. */
	type FieldSpec = readonly [name: string, kind: Kind | 'code' | 'subtotal'];
	type SectionSpec = {
		readonly name: string;
		readonly title?: string;
		readonly icon?: string;
		readonly hint?: string;
		readonly closed?: true;
		/** One field to a row; otherwise two. */
		readonly stack?: true;
		readonly fields: readonly FieldSpec[];
	};

	const TEXT: Kind = { kind: 'text' };
	const RECORD: Kind = { kind: 'json', shape: { kind: 'record', of: { kind: 'json' } } };
	const REFERENCES: Kind = { kind: 'custom', of: 'references' };
	const READS: Kind = { kind: 'custom', of: 'reads' };
	const DIRECTION: Kind = { kind: 'enum', values: ['ADD', 'DEDUCT'] };
	const WINDOW: Kind = { kind: 'enum', values: ['MONTH', 'YEAR'] };

	const definition = (hint: string): SectionSpec => ({
		name: 'definition',
		title: 'Definition',
		icon: 'lucide:file-text',
		hint,
		stack: true,
		fields: [
			['code', TEXT],
			['description', TEXT]
		]
	});
	const rule = (hint: string, ...fields: FieldSpec[]): SectionSpec => ({
		name: 'rule',
		title: 'Rule',
		icon: 'lucide:code',
		hint,
		fields
	});
	const posting = (hint: string, ...fields: FieldSpec[]): SectionSpec => ({
		name: 'posting',
		title: 'Posting',
		icon: 'lucide:arrow-down-up',
		hint,
		closed: true,
		fields: [['subtotal', 'subtotal'], ...fields]
	});
	const CONFIGURATION: SectionSpec = {
		name: 'configuration',
		title: 'Configuration',
		icon: 'lucide:database',
		hint: 'Lookup values and source references used by the rule.',
		closed: true,
		fields: [
			['lookup', RECORD],
			['references', REFERENCES]
		]
	};

	/** What a row of each family shows, in the order it is read. */
	const SECTIONS: Record<LawFamily, readonly SectionSpec[]> = {
		subtotal: [
			{
				name: 'definition',
				fields: [
					['code', TEXT],
					['name', TEXT],
					['previous', 'subtotal'],
					['balance_window', WINDOW],
					['calculation', 'code']
				]
			}
		],
		allowance_catalog: [
			definition('The catalog row: its identity and the agreement it prices.'),
			rule(
				'Who is eligible, how much is paid, and the economic date of the ledger line.',
				['eligibility', 'code'],
				['conversion', 'code']
			),
			posting('Where the amount lands and whether it is rated.', [
				'include_in_rate',
				{ kind: 'bool' }
			]),
			CONFIGURATION
		],
		overtime_catalog: [
			definition('The catalog row: its identity and the work pattern it prices.'),
			rule(
				'Eligibility, the paid multiplier and the economic date of the ledger line.',
				['eligibility', 'code'],
				['conversion', 'code']
			),
			posting('The subtotal and direction of the priced hours.', ['direction', DIRECTION]),
			CONFIGURATION
		],
		statutory_contribution_catalog: [
			definition('The scheme and its identity.'),
			rule(
				'Eligibility and the employee and employer amounts.',
				['eligibility', 'code'],
				['employee_amount', 'code'],
				['employer_amount', 'code'],
				['depends_on', { kind: 'text', many: true }]
			),
			posting(
				'The subtotals, scheme kind and balance window.',
				['employer_cost_subtotal', 'subtotal'],
				['kind', { kind: 'enum', values: ['CONTRIBUTION', 'TAX'] }],
				['balance_window', WINDOW],
				['assessed', { kind: 'enum', values: ['EARNED', 'PAID'] }]
			),
			CONFIGURATION
		],
		leave_catalog: [
			definition('The leave type, its identity and how it is paid.'),
			rule(
				'Eligibility, the share of a normal day a slot pays and what a cashed-out entry pays.',
				['eligibility', 'code'],
				['paid_share', 'code'],
				['payout', 'code']
			),
			posting('The subtotal that receives a payout.'),
			CONFIGURATION
		],
		claim_catalog: [
			definition('The claim type, its identity and the entry it prices.'),
			rule(
				'Eligibility and the claim conversion; the entry owns the economic date.',
				['eligibility', 'code'],
				['conversion', 'code']
			),
			posting('The subtotal that receives the reimbursement.'),
			CONFIGURATION
		],
		adhoc_catalog: [
			definition('The one-off payment or deduction and its identity.'),
			rule(
				'Eligibility, conversion and off-cycle eligibility; the entry owns the economic date.',
				['eligibility', 'code'],
				['conversion', 'code'],
				['off_cycle_eligible', { kind: 'bool' }]
			),
			posting(
				'The subtotal, direction and party of the posting.',
				['direction', DIRECTION],
				['party', { kind: 'enum', values: ['EMPLOYEE', 'EMPLOYER'] }]
			),
			CONFIGURATION
		],
		loan_catalog: [
			definition('The loan or salary-advance type and its identity.'),
			{
				...rule(
					'Who may be given this loan. Checked when a loan is recorded; a loan it refuses is not saved.',
					['eligibility', 'code']
				),
				stack: true
			},
			posting('The subtotal that receives advances and repayments.'),
			CONFIGURATION
		],
		work_event_catalog: [
			definition('The event type and its identity.'),
			posting('The subtotal that receives a priced event, where one exists.'),
			CONFIGURATION
		],
		workplace_case_catalog: [
			definition('The case type, its identity and what it does.'),
			{
				name: 'configuration',
				title: 'Configuration',
				icon: 'lucide:database',
				hint: 'Events, lookup values and source references used by the workflow.',
				fields: [
					['events', RECORD],
					['lookup', RECORD],
					['references', REFERENCES]
				]
			},
			posting('The subtotal that receives a priced case outcome, where one exists.')
		],
		registered_rule: [
			{
				name: 'definition',
				title: 'Definition',
				icon: 'lucide:file-text',
				fields: [
					['description', TEXT],
					['code', TEXT],
					['target_collection', TEXT],
					['events', { kind: 'enum', values: ['create', 'update', 'delete'], many: true }],
					['order', { kind: 'int' }]
				]
			},
			{
				name: 'reads',
				title: 'Reads',
				icon: 'lucide:database',
				hint: 'The rows this rule loads before it runs. Each root is the same filter builder the tables use.',
				stack: true,
				fields: [['reads', READS]]
			},
			{
				...rule(
					'The condition and validation the rule runs.',
					['condition', 'code'],
					['validate', 'code'],
					['lookup', RECORD],
					['references', REFERENCES]
				),
				stack: true
			}
		],
		registered_effect: [
			{
				name: 'definition',
				title: 'Definition',
				icon: 'lucide:file-text',
				fields: [
					['description', TEXT],
					['code', TEXT],
					['name', TEXT],
					['source_collection', TEXT],
					[
						'events',
						{ kind: 'enum', values: ['create', 'update', 'delete', 'seal', 'exit'], many: true }
					],
					['target_collection', TEXT],
					['target_action', { kind: 'enum', values: ['create', 'update', 'delete'] }]
				]
			},
			{
				name: 'reads',
				title: 'Reads',
				icon: 'lucide:database',
				hint: 'The rows this effect loads before it runs, shown with the same filter builder as the tables.',
				closed: true,
				stack: true,
				fields: [['reads', READS]]
			},
			{
				name: 'effect',
				title: 'Effect',
				icon: 'lucide:code',
				hint: 'The condition and the rows the effect writes.',
				stack: true,
				fields: [
					['condition', 'code'],
					['effects', 'code'],
					['lookup', RECORD],
					['references', REFERENCES]
				]
			}
		]
	};

	export const LAW_FAMILY_LABEL: Record<LawFamily, string> = {
		subtotal: 'Subtotals',
		allowance_catalog: 'Allowances',
		overtime_catalog: 'Overtime and work',
		statutory_contribution_catalog: 'Statutory contributions',
		leave_catalog: 'Leave',
		claim_catalog: 'Claims',
		adhoc_catalog: 'Ad hoc',
		loan_catalog: 'Loans',
		work_event_catalog: 'Work events',
		workplace_case_catalog: 'Workplace cases',
		registered_rule: 'Registered rules',
		registered_effect: 'Registered behaviour'
	};

	/** The row of a law a screen is editing; `code` null is a row being added. */
	export type LawRowTarget = { readonly family: LawFamily; readonly code: string | null };

	const title = (name: string) => `${name[0]?.toUpperCase()}${name.slice(1).replaceAll('_', ' ')}`;
</script>

<script lang="ts">
	/** One row of a law, edited as the folded law holds it. Saving hands the patch to the one save question. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Button, CodeEditor, Combobox, Editor, Label, Section, Sheet } from '@norbital-ai/ui';
	import { Cluster, Columns, Stack } from '@norbital-ai/ui/layout';
	import type { Law } from '../../law.js';
	import type { Json, JsonObject } from '../../payroll_engine/foundation.js';
	import { patchOf } from './law_save.js';

	let {
		ctx,
		law,
		target = $bindable(),
		save
	}: {
		ctx: PageContext;
		law: Law;
		target: LawRowTarget | null;
		/** Asks the save question for a patch; `done` runs once it is written. */
		save: (patch: JsonObject, done: () => void) => void;
	} = $props();

	let edits = $state<Record<string, Json>>({});
	const held = $derived(
		target === null ? undefined : law.rows[target.family].find((row) => row.code === target?.code)
	);
	const value = $derived<JsonObject>({ ...held, ...edits });
	const code = $derived(typeof value.code === 'string' ? value.code.trim() : '');
	const adding = $derived(target !== null && target.code === null);
	const valid = $derived(
		code !== '' &&
			(!adding || target === null || !law.rows[target.family].some((row) => row.code === code))
	);
	const subtotals = $derived(
		law.rows.subtotal.map((row) => ({
			value: String(row.code),
			label: typeof row.name === 'string' ? row.name : String(row.code),
			description: String(row.code)
		}))
	);
	const fields = (row: JsonObject | undefined): JsonObject =>
		Object.fromEntries(Object.entries(row ?? {}).filter(([name]) => name !== 'code'));
	const close = () => {
		target = null;
		edits = {};
	};
	function submit() {
		if (target === null || !valid) return;
		const { family } = target;
		save(
			patchOf(
				{ [family]: held === undefined ? {} : { [code]: fields(held) } },
				{ [family]: { [code]: fields(value) } }
			),
			close
		);
	}
	function remove() {
		if (target === null || target.code === null) return;
		save({ [target.family]: { [target.code]: null } }, close);
	}
</script>

{#snippet control([name, kind]: FieldSpec)}
	<Stack gap="xs">
		<Label for="law-row-{name}">{title(name)}</Label>
		{#if kind === 'code'}
			<CodeEditor
				language="javascript"
				wrap
				value={String(value[name] ?? '')}
				aria-label={title(name)}
				on_change={(next) => (edits[name] = next === '' ? null : next)}
			/>
		{:else if kind === 'subtotal'}
			<Combobox
				id="law-row-{name}"
				clearable
				options={subtotals}
				value={typeof value[name] === 'string' ? value[name] : null}
				on_change={(next) => (edits[name] = next)}
			/>
		{:else}
			<Editor
				{ctx}
				id="law-row-{name}"
				{name}
				{kind}
				value={value[name] ?? null}
				row={value}
				disabled={name === 'code' && !adding}
				on_change={(next) => (edits[name] = next)}
			/>
		{/if}
	</Stack>
{/snippet}

<Sheet
	open={target !== null}
	on_open_change={(open) => {
		if (!open) close();
	}}
	title={target === null
		? ''
		: `${LAW_FAMILY_LABEL[target.family]} · ${target.code ?? ctx.t('law_row.new')}`}
>
	{#if target !== null}
		<Stack gap="md">
			{#each SECTIONS[target.family] as section, at (section.name)}
				<Section
					name="law_row_{section.name}"
					first={at === 0}
					default_open={section.closed !== true}
					{...section.title === undefined ? {} : { title: section.title }}
					{...section.icon === undefined ? {} : { icon: section.icon }}
					{...section.hint === undefined ? {} : { hint: section.hint }}
				>
					{#if section.stack}
						<Stack gap="md">
							{#each section.fields as field (field[0])}{@render control(field)}{/each}
						</Stack>
					{:else}
						<Columns count={2} gap="md">
							{#each section.fields as field (field[0])}{@render control(field)}{/each}
						</Columns>
					{/if}
				</Section>
			{/each}
			<Cluster gap="sm" justify="end">
				{#if !adding}
					<Button variant="destructive" onclick={remove}>{ctx.t('law_row.remove')}</Button>
				{/if}
				<Button disabled={!valid} onclick={submit}>{ctx.t('law_save.save')}</Button>
			</Cluster>
		</Stack>
	{/if}
</Sheet>
