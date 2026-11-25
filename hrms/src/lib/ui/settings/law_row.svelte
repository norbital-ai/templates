<script lang="ts" module>
	import type { MessageKey } from '@norbital-ai/bolt';
	import type { Kind } from '@norbital-ai/ui';
	import type { LawFamily } from '../../../data/model/jurisdiction/service/law.js';

	/** How a field is edited: by its kind, as an expression, or as the code of a subtotal of the same law. */
	type FieldSpec = readonly [name: string, kind: Kind | 'code' | 'subtotal'];
	type SectionSpec = {
		readonly name: string;
		readonly title?: MessageKey;
		readonly icon?: string;
		readonly hint?: MessageKey;
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

	const definition = (hint: MessageKey): SectionSpec => ({
		name: 'definition',
		title: 'law_row.section.definition',
		icon: 'lucide:file-text',
		hint,
		stack: true,
		fields: [
			['code', TEXT],
			['description', TEXT]
		]
	});
	const rule = (hint: MessageKey, ...fields: FieldSpec[]): SectionSpec => ({
		name: 'rule',
		title: 'law_row.section.rule',
		icon: 'lucide:code',
		hint,
		fields
	});
	const posting = (hint: MessageKey, ...fields: FieldSpec[]): SectionSpec => ({
		name: 'posting',
		title: 'law_row.section.posting',
		icon: 'lucide:arrow-down-up',
		hint,
		closed: true,
		fields: [['subtotal', 'subtotal'], ...fields]
	});
	const CONFIGURATION: SectionSpec = {
		name: 'configuration',
		title: 'law_row.section.configuration',
		icon: 'lucide:database',
		hint: 'law_row.hint.configuration',
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
			definition('law_row.hint.allowance_catalog.definition'),
			rule('law_row.hint.allowance_catalog.rule', ['eligibility', 'code'], ['conversion', 'code']),
			posting('law_row.hint.allowance_catalog.posting', ['include_in_rate', { kind: 'bool' }]),
			CONFIGURATION
		],
		overtime_catalog: [
			definition('law_row.hint.overtime_catalog.definition'),
			rule('law_row.hint.overtime_catalog.rule', ['eligibility', 'code'], ['conversion', 'code']),
			posting('law_row.hint.overtime_catalog.posting', ['direction', DIRECTION]),
			CONFIGURATION
		],
		statutory_contribution_catalog: [
			definition('law_row.hint.statutory_contribution_catalog.definition'),
			rule(
				'law_row.hint.statutory_contribution_catalog.rule',
				['eligibility', 'code'],
				['employee_amount', 'code'],
				['employer_amount', 'code'],
				['depends_on', { kind: 'text', many: true }]
			),
			posting(
				'law_row.hint.statutory_contribution_catalog.posting',
				['employer_cost_subtotal', 'subtotal'],
				['kind', { kind: 'enum', values: ['CONTRIBUTION', 'TAX'] }],
				['balance_window', WINDOW],
				['assessed', { kind: 'enum', values: ['EARNED', 'PAID'] }]
			),
			CONFIGURATION
		],
		leave_catalog: [
			definition('law_row.hint.leave_catalog.definition'),
			rule(
				'law_row.hint.leave_catalog.rule',
				['eligibility', 'code'],
				['paid_share', 'code'],
				['payout', 'code']
			),
			posting('law_row.hint.leave_catalog.posting'),
			CONFIGURATION
		],
		claim_catalog: [
			definition('law_row.hint.claim_catalog.definition'),
			rule('law_row.hint.claim_catalog.rule', ['eligibility', 'code'], ['conversion', 'code']),
			posting('law_row.hint.claim_catalog.posting'),
			CONFIGURATION
		],
		adhoc_catalog: [
			definition('law_row.hint.adhoc_catalog.definition'),
			rule(
				'law_row.hint.adhoc_catalog.rule',
				['eligibility', 'code'],
				['conversion', 'code'],
				['off_cycle_eligible', { kind: 'bool' }]
			),
			posting(
				'law_row.hint.adhoc_catalog.posting',
				['direction', DIRECTION],
				['party', { kind: 'enum', values: ['EMPLOYEE', 'EMPLOYER'] }]
			),
			CONFIGURATION
		],
		loan_catalog: [
			definition('law_row.hint.loan_catalog.definition'),
			{
				...rule('law_row.hint.loan_catalog.rule', ['eligibility', 'code']),
				stack: true
			},
			posting('law_row.hint.loan_catalog.posting'),
			CONFIGURATION
		],
		work_event_catalog: [
			definition('law_row.hint.work_event_catalog.definition'),
			posting('law_row.hint.work_event_catalog.posting'),
			CONFIGURATION
		],
		workplace_case_catalog: [
			definition('law_row.hint.workplace_case_catalog.definition'),
			{
				name: 'configuration',
				title: 'law_row.section.configuration',
				icon: 'lucide:database',
				hint: 'law_row.hint.workplace_case_catalog.configuration',
				fields: [
					['events', RECORD],
					['lookup', RECORD],
					['references', REFERENCES]
				]
			},
			posting('law_row.hint.workplace_case_catalog.posting')
		],
		registered_rule: [
			{
				name: 'definition',
				title: 'law_row.section.definition',
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
				title: 'law_row.section.reads',
				icon: 'lucide:database',
				hint: 'law_row.hint.registered_rule.reads',
				stack: true,
				fields: [['reads', READS]]
			},
			{
				...rule(
					'law_row.hint.registered_rule.rule',
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
				title: 'law_row.section.definition',
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
				title: 'law_row.section.reads',
				icon: 'lucide:database',
				hint: 'law_row.hint.registered_effect.reads',
				closed: true,
				stack: true,
				fields: [['reads', READS]]
			},
			{
				name: 'effect',
				title: 'law_row.section.effect',
				icon: 'lucide:code',
				hint: 'law_row.hint.registered_effect.effect',
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

	/** The row of a law a screen is editing; `code` null is a row being added. */
	export type LawRowTarget = { readonly family: LawFamily; readonly code: string | null };

	/** The expressions a sentence explains under their editor. */
	const HELPED = ['eligibility', 'conversion', 'paid_share', 'payout'] as const;
</script>

<script lang="ts">
	/**
	 * One row of a law as it stands today, read from its changes: it is not edited in place. Its footer adds a change
	 * (with its date of effect) or corrects the changes that set its values; either opens the fields for that one write.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Button,
		CodeEditor,
		Combobox,
		Editor,
		Label,
		Section,
		Sheet,
		enum_text,
		format,
		label,
		notify_outcome,
		toast
	} from '@norbital-ai/ui';
	import { watch } from '@norbital-ai/ui/behaviors';
	import { fork } from '@norbital-ai/ui/effect';
	import { Cluster, Columns, Stack } from '@norbital-ai/ui/layout';
	import { Effect } from 'effect';
	import { LAW_DEPTH, type Law } from '../../../data/model/jurisdiction/service/law.js';
	import type { Json, JsonObject } from '../../foundation.js';
	import { patchOf } from '../../dated.js';
	import LawSave from './law_save.svelte';
	import { lawWrites, type LawChange } from './law_save.js';

	let {
		ctx,
		law,
		chain,
		target = $bindable()
	}: {
		ctx: PageContext;
		law: Law;
		chain: readonly LawChange[];
		target: LawRowTarget | null;
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
	const title = (name: string) => label(ctx, 'law', name);
	/** What the open fields will write: a new change from a date, or a correction of the changes that set the values. */
	let writing = $state<'change' | 'correction' | null>(null);
	const always = $derived(writing === 'correction');
	let chosen = $state<string | null>(null);
	let saving = $state(false);
	/** The dates of the changes that set this row's values: where a correction is written. */
	const setOn = $derived.by(() => {
		if (target === null || target.code === null) return [];
		const under = `${target.family}/${target.code}`;
		const ids = new Set(
			Object.entries(law.set_by)
				.filter(([path]) => path === under || path.startsWith(`${under}/`))
				.map(([, id]) => id)
		);
		return [
			...new Set(chain.filter((row) => ids.has(row.id)).map((row) => row.effective_from))
		].toSorted();
	});
	const stop = () => {
		edits = {};
		writing = null;
		chosen = null;
	};
	const close = () => {
		target = null;
		stop();
	};
	// a row being added has nothing to read: it opens as a new change
	watch(
		() => adding,
		(isNew) => {
			if (isNew) writing = 'change';
		}
	);
	function write(patch: JsonObject) {
		if (Object.keys(patch).length === 0) return close();
		const writes = lawWrites(chain, law, patch, always ? null : (chosen ?? law.on));
		if (writes.create.length === 0 && writes.update.length === 0) return close();
		saving = true;
		fork(
			ctx
				.act({
					'jurisdiction_change.create': writes.create,
					'jurisdiction_change.update': writes.update
				})
				.pipe(
					Effect.tap((outcome) =>
						Effect.sync(() => {
							notify_outcome(ctx, outcome);
							if (outcome.kind === 'committed') close();
						})
					),
					Effect.catch((error) =>
						Effect.sync(() =>
							toast.error(error instanceof Error ? error.message : ctx.t('component.error'))
						)
					),
					Effect.ensuring(Effect.sync(() => (saving = false)))
				)
		);
	}
	function submit() {
		if (target === null || !valid) return;
		const { family } = target;
		write(
			patchOf(
				{ [family]: held === undefined ? {} : { [code]: fields(held) } },
				{ [family]: { [code]: fields(value) } },
				LAW_DEPTH
			)
		);
	}
	function remove() {
		if (target === null || target.code === null) return;
		write({ [target.family]: { [target.code]: null } });
	}
</script>

{#snippet control([name, kind]: FieldSpec)}
	{@const helped = HELPED.find((field) => field === name)}
	<Stack gap="xs">
		<Label for="law-row-{name}">{title(name)}</Label>
		{#if kind === 'code'}
			<CodeEditor
				language="javascript"
				wrap
				value={String(value[name] ?? '')}
				aria-label={title(name)}
				readonly={writing === null}
				on_change={(next) => (edits[name] = next === '' ? null : next)}
			/>
		{:else if kind === 'subtotal'}
			<Combobox
				id="law-row-{name}"
				clearable
				options={subtotals}
				value={typeof value[name] === 'string' ? value[name] : null}
				readonly={writing === null}
				on_change={(next) => (edits[name] = next)}
			/>
		{:else if kind.kind === 'enum' && kind.many !== true}
			<Combobox
				id="law-row-{name}"
				options={kind.values.map((option) => ({
					value: option,
					label: label(ctx, 'law', `${name}.${option}`, enum_text(option))
				}))}
				value={typeof value[name] === 'string' ? value[name] : null}
				readonly={writing === null}
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
				readonly={writing === null}
				disabled={name === 'code' && !adding}
				on_change={(next) => (edits[name] = next)}
			/>
		{/if}
		{#if helped}<p class="text-meta">{ctx.t(`models.law.help.${helped}`)}</p>{/if}
	</Stack>
{/snippet}

<Sheet
	open={target !== null}
	on_open_change={(open) => {
		if (!open) close();
	}}
	title={target === null
		? ''
		: `${ctx.t(`law_family.${target.family}`)} · ${target.code ?? ctx.t('law_row.new')}`}
>
	{#if target !== null}
		<!-- the row scrolls; its actions sit flush at the bottom, as a record's do -->
		<div class="flex h-full min-h-0 flex-col gap-4">
			<div class="min-h-0 flex-1 overflow-auto">
				<Stack gap="md">
					{#if writing === 'change'}
						<LawSave
							{ctx}
							id="law-row-effective-from"
							bind:date={() => chosen ?? law.on, (next) => (chosen = next)}
						/>
					{:else if writing === 'correction'}
						<p class="text-sm text-muted-foreground" role="note">
							{ctx.t('law_row.correcting')}
							{setOn.map((day) => format({ kind: 'date' }, day, { locale: ctx.locale })).join(', ')}
						</p>
					{:else}
						<p class="text-sm text-muted-foreground" role="note">{ctx.t('law_row.as_of_today')}</p>
					{/if}
					{#each SECTIONS[target.family] as section, at (section.name)}
						<Section
							name="law_row_{section.name}"
							first={at === 0}
							default_open={section.closed !== true}
							{...section.title === undefined ? {} : { title: ctx.t(section.title) }}
							{...section.icon === undefined ? {} : { icon: section.icon }}
							{...section.hint === undefined ? {} : { hint: ctx.t(section.hint) }}
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
				</Stack>
			</div>
			<Cluster as="footer" gap="sm" justify="end">
				{#if writing === null}
					<Button variant="outline" onclick={() => (writing = 'correction')}
						>{ctx.t('law_row.correct')}</Button
					>
					<Button onclick={() => (writing = 'change')}>{ctx.t('law_row.add_change')}</Button>
				{:else}
					{#if !adding}
						<Button variant="destructive" disabled={saving} onclick={remove}
							>{ctx.t(always ? 'law_row.remove_always' : 'law_row.remove_from')}</Button
						>
					{/if}
					<Button variant="outline" disabled={saving} onclick={() => (adding ? close() : stop())}
						>{ctx.t('component.cancel')}</Button
					>
					<Button disabled={!valid || saving} onclick={submit}
						>{ctx.t(always ? 'law_row.save_correction' : 'law_row.save_change')}</Button
					>
				{/if}
			</Cluster>
		</div>
	{/if}
</Sheet>
