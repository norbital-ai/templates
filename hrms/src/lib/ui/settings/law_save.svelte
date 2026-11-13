<script lang="ts">
	/** Every save of the law asks one question: was it always so, or does it change from a date? */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Button, Editor, Label, Sheet, notify_outcome, toast } from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Stack } from '@norbital-ai/ui/layout';
	import { Effect } from 'effect';
	import type { Law } from '../../law.js';
	import type { JsonObject } from '../../payroll_engine/foundation.js';
	import { lawWrites, type LawChange } from './law_save.js';

	let {
		ctx,
		law,
		chain,
		patch = $bindable(),
		on_saved
	}: {
		ctx: PageContext;
		law: Law;
		chain: readonly LawChange[];
		/** The patch waiting for its answer; null when nothing is being saved. */
		patch: JsonObject | null;
		on_saved?: () => void;
	} = $props();
	let chosen = $state<string | null>(null);
	const date = $derived(chosen ?? law.on);
	let saving = $state(false);

	function write(from: string | null) {
		if (patch === null || saving) return;
		const writes = lawWrites(chain, law, patch, from);
		if (writes.create.length === 0 && writes.update.length === 0) return void (patch = null);
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
							if (outcome.kind === 'committed') {
								on_saved?.();
								patch = null;
								chosen = null;
							}
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
</script>

<Sheet
	open={patch !== null}
	on_open_change={(open) => {
		if (!open) patch = null;
	}}
	title={ctx.t('law_save.title')}
>
	<Stack gap="lg">
		<Button disabled={saving} onclick={() => write(null)}>{ctx.t('law_save.always')}</Button>
		<Stack gap="sm">
			<Stack gap="xs">
				<Label for="law-save-date">{ctx.t('law_save.date')}</Label>
				<Editor
					{ctx}
					id="law-save-date"
					name="effective_from"
					kind={{ kind: 'date' }}
					value={date}
					disabled={saving}
					on_change={(next) => next != null && (chosen = String(next))}
				/>
			</Stack>
			<Button variant="outline" disabled={saving} onclick={() => write(date)}
				>{ctx.t('law_save.from_date')}</Button
			>
		</Stack>
	</Stack>
</Sheet>
