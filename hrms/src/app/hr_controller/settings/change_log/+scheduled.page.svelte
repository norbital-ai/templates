<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Button, Combobox, notify_outcome, Table, toast } from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import { jurisdictions } from '../jurisdiction_scope.svelte.js';
	let { ctx }: { ctx: PageContext } = $props();

	const all = jurisdictions(ctx);
	let code = $state<string | null>(null);
	let starting = $state(false);
	const codes = $derived(all.current?.jurisdiction.rows.map((row) => row.code) ?? []);
	const scope = $derived(code === null ? {} : { jurisdiction_code: { eq: code } });
	function start<E>(run: Effect.Effect<Parameters<typeof notify_outcome>[1], E>) {
		starting = true;
		fork(
			run.pipe(
				Effect.tap((outcome) => Effect.sync(() => notify_outcome(ctx, outcome))),
				Effect.catch((error) =>
					Effect.sync(() =>
						toast.error(error instanceof Error ? error.message : ctx.t('component.error'))
					)
				),
				Effect.ensuring(Effect.sync(() => (starting = false)))
			)
		);
	}
</script>

<AppShell
	title={ctx.t('app.settings.scheduled')}
	description={ctx.t('app.settings.scheduled_description')}
	icon="lucide:calendar-clock"
>
	{#snippet actions()}
		<div class="flex items-center gap-3">
			<Button
				variant="outline"
				disabled={starting}
				onclick={() => start(ctx.run('statutory_research', code === null ? {} : { code }))}
				>{ctx.t('scheduled.research')}</Button
			>
			<Combobox
				aria-label={ctx.t('app.settings.jurisdiction')}
				class="min-w-48"
				clearable
				placeholder={ctx.t('scheduled.all')}
				options={codes.map((value) => ({ value, label: value }))}
				value={code}
				on_change={(next) => (code = next)}
			/>
		</div>
	{/snippet}
	<Table
		{ctx}
		of="statutory_finding"
		key="statutory_findings"
		where={{ ...scope, status: { in: ['PROPOSED', 'CONFIRMED'] } }}
		toolbar={{ new: true, title: ctx.t('scheduled.changes') }}
		columns={[
			'title',
			'jurisdiction_code',
			'fit',
			'status',
			'families',
			'announced_on',
			'source_urls'
		]}
	/>
</AppShell>
