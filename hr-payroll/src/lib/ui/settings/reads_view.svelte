<script lang="ts">
	import { FilterEditor, type FilterValue } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';

	type Json = NonNullable<FilterValue['where']>;
	type Read = {
		readonly model: string;
		readonly filter: FilterValue;
		readonly id: string | null;
		readonly limit: number | null;
		readonly fields: string | null;
	};
	let { value }: { value: unknown } = $props();

	const isRecord = (input: unknown): input is Record<string, unknown> =>
		input !== null && typeof input === 'object' && !Array.isArray(input);
	const isJson = (input: unknown): input is Json => {
		if (
			input === null ||
			typeof input === 'string' ||
			typeof input === 'number' ||
			typeof input === 'boolean'
		)
			return true;
		if (Array.isArray(input)) return input.every((item) => isJson(item));
		return isRecord(input) && Object.values(input).every((item) => isJson(item));
	};
	const reads = $derived.by((): readonly Read[] => {
		if (!isRecord(value)) return [];
		return Object.entries(value).flatMap(([model, spec]) => {
			if (!isRecord(spec)) return [];
			const where = isJson(spec.where) && isRecord(spec.where) ? spec.where : null;
			const held = where === null ? null : where.id;
			const id =
				held !== null && isRecord(held) && isRecord(held.eq) && typeof held.eq.var === 'string'
					? held.eq.var
					: typeof held === 'string'
						? held
						: null;
			const rest =
				where === null
					? null
					: Object.fromEntries(Object.entries(where).filter(([key]) => key !== 'id'));
			return [
				{
					model,
					filter: {
						...(rest !== null && Object.keys(rest).length > 0 ? { where: rest } : {}),
						...(isJson(spec.orderBy) ? { orderBy: spec.orderBy } : {})
					},
					id,
					limit: typeof spec.limit === 'number' ? spec.limit : null,
					fields:
						spec.fields === 'all'
							? 'all'
							: Array.isArray(spec.fields)
								? spec.fields.map(String).join(', ')
								: null
				}
			];
		});
	});
	// the rule reads typed variables (`ctx.entry`, `ctx.subject`, …); the filter UI only needs their labels
	const variables = {
		presets: [
			'ctx.entry',
			'ctx.subject',
			'ctx.subject.employment',
			'ctx.subject.employer',
			'ctx.run',
			'ctx.lookup',
			'ctx.reads',
			'ctx.subtotals',
			'ctx.balances',
			'ctx.statutory',
			'ctx.as_of',
			'ctx.today'
		],
		validate: () => undefined
	};
</script>

{#if reads.length === 0}
	<p class="text-sm text-muted-foreground">No reads.</p>
{:else}
	<Stack gap="sm">
		{#each reads as read (read.model)}
			<div class="rounded-md border border-border/70">
				<div class="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2">
					<code class="font-mono text-xs">{read.model}</code>
					{#if read.limit !== null}<span class="text-xs text-muted-foreground"
							>{read.limit} rows</span
						>{/if}
				</div>
				<div class="grid gap-2 p-3">
					{#if read.fields !== null}<div class="flex items-center gap-2 text-xs">
							<span class="text-muted-foreground">fields</span>
							<span class="font-mono">{read.fields}</span>
						</div>{/if}
					{#if read.id !== null}<div class="flex items-center gap-2 text-xs">
							<span class="text-muted-foreground">id</span>
							<code class="rounded-sm bg-muted px-1.5 py-0.5 font-mono">{read.id}</code>
						</div>{/if}
					{#if read.filter.where !== undefined || read.filter.orderBy !== undefined}<FilterEditor
							model={read.model}
							value={read.filter}
							readonly
							{variables}
						/>{/if}
				</div>
			</div>
		{/each}
	</Stack>
{/if}
