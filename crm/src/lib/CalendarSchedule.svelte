<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		EmptyState,
		EventCalendar,
		Icon,
		Popover,
		Show,
		open_record,
		type CalendarEvent
	} from '@norbital-ai/ui';
	import { Bound, Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { DateTime } from 'effect';

	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const day = ctx.clock('day');
	const counts = $derived(
		ctx.query({
			tasks: {
				where: { status: { eq: 'open' }, due_on: { lt: day.today } },
				aggregate: { count: true }
			}
		})
	);
	const read = ctx.query({
		calendar_entries: {
			fields: ['subject', 'event_status', 'start_at', 'end_at', 'start_on', 'end_on']
		},
		tasks: {
			where: { status: { eq: 'open' } },
			fields: ['subject', 'kind', 'due_on'],
			company: { fields: ['name'] },
			owner: { fields: ['name'] },
			order_by: { due_on: 'asc' }
		},
		companies: { aggregate: { by: 'stage', count: true } }
	});
	// Query company names separately for the Clients / Leads metric popovers (capped to 50 rows).
	const companiesRead = ctx.query({
		companies: {
			where: { stage: { in: ['client', 'lead', 'qualified'] } },
			fields: ['name', 'stage'],
			order_by: { name: 'asc' },
			limit: 50
		}
	});
	const events = $derived.by(() => {
		const result: CalendarEvent[] = [];
		for (const entry of read.current?.calendar_entries.rows ?? []) {
			const allDay = entry.start_on != null;
			const start = allDay
				? new Date(`${entry.start_on}T00:00`)
				: entry.start_at == null
					? null
					: new Date(entry.start_at);
			const end = allDay
				? entry.end_on == null
					? null
					: new Date(`${entry.end_on}T00:00`)
				: entry.end_at == null
					? null
					: new Date(entry.end_at);
			if (
				start === null ||
				end === null ||
				!Number.isFinite(start.getTime()) ||
				!Number.isFinite(end.getTime())
			)
				continue;
			result.push({
				id: `calendar_entries/${entry.id}`,
				start,
				end,
				all_day: allDay,
				title:
					entry.event_status === 'cancelled'
						? `${entry.subject} · ${t('calendar.cancelled')}`
						: entry.subject,
				editable: false,
				locked_reason: t('calendar.source_only'),
				...(entry.event_status === 'cancelled' ? { color: 'var(--muted-foreground)' } : {})
			});
		}
		for (const task of read.current?.tasks.rows ?? []) {
			const start = new Date(`${task.due_on}T00:00`);
			const end = new Date(start);
			end.setDate(end.getDate() + 1);
			result.push({
				id: `tasks/${task.id}`,
				start,
				end,
				all_day: true,
				title: task.subject,
				editable: false,
				color: 'var(--chart-2)'
			});
		}
		return result;
	});
	const incomplete = $derived(
		[read.current?.calendar_entries, read.current?.tasks, read.current?.companies].some(
			(page) => page?.next != null
		)
	);

	const openTasks = $derived(read.current?.tasks.rows ?? []);
	const overdueTasks = $derived(openTasks.filter((task) => task.due_on < day.today));
	const allCompanies = $derived(companiesRead.current?.companies.rows ?? []);
	const clientCompanies = $derived(allCompanies.filter((c) => c.stage === 'client'));
	const leadCompanies = $derived(
		allCompanies.filter((c) => c.stage === 'lead' || c.stage === 'qualified')
	);

	type PopoverItem = {
		readonly id: string;
		readonly model: 'companies' | 'tasks';
		readonly title: string;
		readonly meta?: string;
		readonly date?: string;
	};
	const stats = $derived([
		{
			key: 'clients',
			label: t('dashboard.clients'),
			value: read.current?.companies.rows.find((row) => row.key.stage === 'client')?.count ?? 0,
			items: clientCompanies.map((c): PopoverItem => ({
				id: c.id,
				model: 'companies',
				title: c.name
			}))
		},
		{
			key: 'leads',
			label: t('dashboard.leads'),
			value: (read.current?.companies.rows ?? [])
				.filter((row) => row.key.stage === 'lead' || row.key.stage === 'qualified')
				.reduce((n, row) => n + row.count, 0),
			items: leadCompanies.map((c): PopoverItem => ({
				id: c.id,
				model: 'companies',
				title: c.name
			}))
		},
		{
			key: 'open_tasks',
			label: t('dashboard.open_tasks'),
			value: read.current?.tasks.total ?? 0,
			items: openTasks.map((task): PopoverItem => ({
				id: task.id,
				model: 'tasks',
				title: task.subject,
				date: task.due_on,
				...(task.company?.name ? { meta: task.company.name } : {})
			}))
		},
		{
			key: 'overdue',
			label: t('dashboard.overdue'),
			value: counts.current?.tasks.count ?? 0,
			items: overdueTasks.map((task): PopoverItem => ({
				id: task.id,
				model: 'tasks',
				title: task.subject,
				date: task.due_on,
				...(task.company?.name ? { meta: task.company.name } : {})
			}))
		}
	]);

	let openMetric = $state<string | null>(null);
	const open = (key: string) => {
		const [model, id] = key.split('/');
		if (model && id) open_record(model, id);
	};
</script>

<Scroll name={t('dashboard.title')} size="fill" inset>
	{#if read.error}<EmptyState title={t('dashboard.error')} hint={read.error.message} />
	{:else if read.current === undefined}<EmptyState title={t('dashboard.loading')} />
	{:else if incomplete}<EmptyState title={t('dashboard.error')} hint={t('reports.incomplete')} />
	{:else}
		<Stack gap="lg">
			<Grid as="dl" minimum="compact" gap="md">
				{#each stats as stat (stat.key)}
					<Popover.Root
						open={openMetric === stat.key}
						on_open_change={(next) => (openMetric = next ? stat.key : null)}
					>
						<Popover.Trigger>
							{#snippet child({ props })}
								<button
									{...props}
									type="button"
									class="flex w-full cursor-pointer flex-col gap-1 rounded-xl border bg-card px-4 py-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
								>
									<dt class="text-meta flex items-center justify-between gap-2">
										<span>{stat.label}</span>
										<Icon name="lucide:chevron-down" class="size-3.5 opacity-60" />
									</dt>
									<dd class="text-2xl font-semibold tracking-tight tabular-nums">{stat.value}</dd>
								</button>
							{/snippet}
						</Popover.Trigger>
						<Popover.Content align="start" class="max-h-72 w-80 overflow-y-auto p-2">
							<div class="mb-1.5 flex items-center justify-between border-b px-2 pb-1.5">
								<span class="text-xs font-semibold text-foreground">{stat.label}</span>
								<span class="text-xs tabular-nums text-muted-foreground">{stat.value}</span>
							</div>
							{#if stat.items.length === 0}
								<p class="px-2 py-2 text-xs text-muted-foreground">{t('dashboard.none')}</p>
							{:else}
								<div class="flex flex-col gap-0.5">
									{#each stat.items as item (item.id)}
										<button
											type="button"
											class="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted"
											onclick={() => {
												openMetric = null;
												open_record(item.model, item.id);
											}}
										>
											<div class="min-w-0 flex-1">
												<p class="truncate font-medium">{item.title}</p>
												{#if item.meta}<p class="truncate text-xs text-muted-foreground">
														{item.meta}
													</p>{/if}
											</div>
											{#if item.date}
												<span class="shrink-0 text-xs tabular-nums text-muted-foreground">
													<Show {ctx} kind={{ kind: 'date' }} value={item.date} />
												</span>
											{/if}
										</button>
									{/each}
								</div>
							{/if}
						</Popover.Content>
					</Popover.Root>
				{/each}
			</Grid>
			<Bound class="h-[42rem]">
				<EventCalendar
					{ctx}
					{events}
					view="month"
					views={['day', 'week', 'month']}
					readonly
					on_event_click={(event) => open(String(event.id))}
				/>
			</Bound>
		</Stack>
	{/if}
</Scroll>
