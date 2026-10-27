<script lang="ts">
	/**
	 * The behaviours record as one accordion per rule, summarised in words: what it is called and what starts it. Open,
	 * the rule's condition, effect and references come first; what it targets, its events, fields and reads sit behind
	 * "Advanced", reads as a name/value table. Conditions are in the code editor (`format: 'cel'`). Rules add and
	 * remove; the record's format `version` is carried, never edited. Read-only, the same accordion shows the values.
	 */
	import { bolt } from '$bolt';
	import { Button, Editor, Icon, singular, type Json, type Kind } from '@norbital-ai/ui';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import { Schema } from 'effect';
	import { STATUTORY_FIELDS } from '../../payroll_engine/statutory_fields.js';
	import { labelled } from './labelled.js';

	let {
		value,
		onChange,
		disabled = false,
		readonly = false
	}: {
		value: unknown;
		onChange?: (next: Json) => void;
		disabled?: boolean;
		readonly?: boolean;
	} = $props();
	const t = bolt.t;

	// rules are held as stored: an edit replaces one rule's json, so no key the editor does not show is dropped
	const Rule = Schema.Struct({
		id: Schema.String,
		catalog: Schema.optionalKey(Schema.String),
		target_collection: Schema.optionalKey(Schema.String),
		events: Schema.Array(Schema.String)
	});
	const Record_ = Schema.Struct({
		version: Schema.Number,
		rules: Schema.Array(Schema.Record(Schema.String, Schema.Json))
	});
	const isRule = Schema.is(Rule);
	const isRuleJson = Schema.is(Schema.Record(Schema.String, Schema.Json));

	const RULE = STATUTORY_FIELDS.settings.behaviours.shape.fields.rules.of.fields;
	const kindOf = (name: keyof typeof RULE): Kind =>
		labelled(bolt, 'jurisdiction_settings', `behaviours.rules.${name}`, RULE[name]);
	const main = {
		kind: 'object',
		fields: {
			id: kindOf('id'),
			catalog: kindOf('catalog'),
			when: kindOf('when'),
			effect: kindOf('effect'),
			references: kindOf('references')
		}
	} as const satisfies Kind;
	const advanced = {
		kind: 'object',
		fields: {
			target_collection: kindOf('target_collection'),
			events: kindOf('events'),
			fields: kindOf('fields'),
			// each read: the model it reads, its filter and the columns it selects; other keys are kept
			reads: {
				kind: 'record',
				optional: true,
				label: t('models.jurisdiction_settings.fields.behaviours.rules.reads'),
				of: {
					kind: 'object',
					fields: {
						collection: { kind: 'text', label: t('behaviours.read_collection') },
						where: { kind: 'json', optional: true, label: t('behaviours.read_where') },
						select: {
							kind: 'list',
							of: { kind: 'text' },
							optional: true,
							label: t('behaviours.read_select')
						}
					}
				}
			}
		}
	} as const satisfies Kind;

	const record = $derived(Schema.is(Record_)(value) ? value : null);
	const version = $derived(record?.version ?? 1);
	const rules = $derived<readonly { readonly [key: string]: Json }[]>(record?.rules ?? []);
	const emit = (next: readonly { readonly [key: string]: Json }[]) =>
		onChange?.({ version, rules: [...next] });
	// a cleared optional key is removed, not stored as null
	const replace = (index: number, next: unknown) => {
		if (!isRuleJson(next)) return;
		const rule = Object.fromEntries(Object.entries(next).filter(([, held]) => held !== null));
		emit(rules.map((held, i) => (i === index ? rule : held)));
	};
	const add = () => emit([...rules, { id: `rule-${rules.length + 1}`, events: [] }]);
	let opened = $state<boolean[]>([]);
	const remove = (index: number) => {
		opened = opened.filter((_, i) => i !== index);
		emit(rules.filter((_, i) => i !== index));
	};
	/** `pin-settled-entries` → `Pin settled entries`. */
	const words = (code: string) =>
		code
			.replace(/[_-]+/g, ' ')
			.trim()
			.toLowerCase()
			.replace(/^\w/, (c) => c.toUpperCase());
	/** What starts a rule, in words: its events on what it targets (a model or a catalogue family). */
	const trigger = (rule: { readonly [key: string]: Json }) => {
		if (!isRule(rule)) return '';
		const events = rule.events.map((event) => words(event).toLowerCase()).join(', ');
		const target =
			rule.target_collection !== undefined
				? singular(bolt, rule.target_collection)
				: rule.catalog !== undefined
					? words(rule.catalog)
					: '';
		return target === ''
			? t('behaviours.runs_on', { events })
			: t('behaviours.runs_on_target', { events, target });
	};
</script>

{#if record == null}
	<p class="text-meta">{t('behaviours.unrecognized')}</p>
{:else}
	{#each rules as rule, index (index)}
		{@const id = typeof rule.id === 'string' ? rule.id : ''}
		<!-- a rule's editors mount when it opens: eight closed rules held ~30 code editors measuring off-screen -->
		<details
			class="group border-t"
			ontoggle={(event) => (opened[index] = event.currentTarget.open)}
		>
			<summary class="cursor-pointer list-none py-2 select-none [&::-webkit-details-marker]:hidden">
				<Inline gap="sm" align="center" justify="between">
					<Inline gap="sm" align="center">
						<Icon
							name="lucide:chevron-right"
							class="size-4 text-muted-foreground transition-transform group-open:rotate-90"
						/>
						<span class="text-sm font-medium"
							>{id === '' ? t('behaviours.untitled_rule') : words(id)}</span
						>
						<span class="text-meta">{trigger(rule)}</span>
					</Inline>
					{#if !readonly}
						<Button
							variant="ghost"
							size="icon"
							aria-label={t('behaviours.remove_rule')}
							title={t('behaviours.remove_rule')}
							{disabled}
							onclick={(event) => {
								event.preventDefault();
								remove(index);
							}}
						>
							<Icon name="lucide:trash-2" class="size-4" />
						</Button>
					{/if}
				</Inline>
			</summary>
			{#if opened[index]}
				<div class="pb-3">
					<Stack gap="sm">
						<Editor
							kind={main}
							name="behaviours.rules.{index}"
							value={rule}
							onChange={(next) => replace(index, next)}
							{readonly}
							{disabled}
						/>
						<details class="group/advanced">
							<summary
								class="cursor-pointer list-none py-1 text-xs font-medium text-muted-foreground select-none [&::-webkit-details-marker]:hidden"
							>
								<Inline gap="xs" align="center">
									<Icon
										name="lucide:chevron-right"
										class="size-3.5 transition-transform group-open/advanced:rotate-90"
									/>
									{t('behaviours.advanced')}
								</Inline>
							</summary>
							<Editor
								kind={advanced}
								name="behaviours.rules.{index}"
								value={rule}
								onChange={(next) => replace(index, next)}
								{readonly}
								{disabled}
							/>
						</details>
					</Stack>
				</div>
			{/if}
		</details>
	{/each}
	{#if !readonly}
		<Button variant="outline" size="sm" {disabled} onclick={add}>
			<Icon name="lucide:plus" class="size-4" />
			{t('behaviours.add_rule')}
		</Button>
	{/if}
{/if}
