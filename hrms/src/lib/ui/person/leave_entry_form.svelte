<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { Id } from '@norbital-ai/bolt';
	import { Effect } from 'effect';
	import { watch } from 'runed';
	import { date_period, each_day, month_of, plain_date } from '../../date.js';
	import { Button, Combobox, confirm_action, notify_outcome, Picker, toast } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { fork } from '@norbital-ai/ui/effect';
	import { todayKey } from '../format/calendar.js';
	import { accountsOf, eventsOf, leftOn, unlimited } from '../../ledger/core.js';
	import { isJsonObject, jsonObject } from '../../payroll_engine/foundation.js';
	import { chainOf, startsOf, versionOn } from '../../payroll_engine/contract_change.js';
	import { PAID_NOTE, paidPeriods } from '../payroll/paid_period.svelte.js';

	let {
		ctx,
		entityId,
		employmentId: initialEmployment,
		entry = null,
		catalogId = null,
		person = false,
		locked = false,
		onDone
	}: {
		ctx: PageContext;
		entityId: Id<'entity'>;
		employmentId?: Id<'employee_contract'> | null;
		/** A filed entry: its half-days change in place. One a run paid may go too: the next run carries the difference. */
		entry?: Id<'leave_catalog_entry'> | null;
		catalogId?: Id<'leave_catalog'> | null;
		/** Names the person the entry is for: the HR controller's view; self-service is already theirs. */
		person?: boolean;
		/** Shows a filed entry without changing it: self-service. */
		locked?: boolean;
		onDone?: () => void;
	} = $props();

	const fixedEmployment = initialEmployment != null;
	const showPerson = $derived(!fixedEmployment || person);
	// a filed entry keeps its leave type
	const fixedCatalog = $derived(entry != null);
	const editable = $derived(!locked);
	const paid = paidPeriods(ctx);
	const clock = ctx.clock('day');
	const today = $derived(clock.today || todayKey());
	const [year, month] = today.split('-').map(Number) as [number, number];
	let at = $state(new Date(Date.UTC(year, month - 1, 1)));
	let chosen = $state<Id<'employee_contract'> | null>(initialEmployment ?? null);
	let catalog = $state<Id<'leave_catalog'> | null>(catalogId ?? null);
	let sessions = $state<{ date: string; part: 'AM' | 'PM' }[]>([]);
	let saving = $state(false);
	// the filed entry's half-days
	const captures = $derived(
		entry == null
			? null
			: ctx.query({
					leave_catalog_entry: { where: { id: { eq: entry } }, fields: ['revision'], limit: 1 },
					leave_catalog_entry_day: {
						where: { leave_entry_id: { eq: entry } },
						fields: ['id', 'revision', 'incurred_on', 'part', 'payroll_run_id'],
						order_by: { incurred_on: 'asc' },
						limit: 10000
					}
				})
	);
	const sealed = $derived(
		new Set(
			(captures?.current?.leave_catalog_entry_day.rows ?? [])
				.filter((row) => row.payroll_run_id != null)
				.map((row) => `${String(row.incurred_on)}:${row.part}`)
		)
	);
	// a filed entry opens on its half-days
	let loaded = false;
	watch(
		() => captures?.current,
		(answer) => {
			if (answer === undefined || loaded) return;
			loaded = true;
			sessions = answer.leave_catalog_entry_day.rows.map((row) => ({
				date: String(row.incurred_on),
				part: row.part
			}));
			if (sessions[0] !== undefined) at = new Date(`${sessions[0].date.slice(0, 7)}-01T00:00:00Z`);
		}
	);

	const contracts = $derived(
		ctx.query({
			employee_contract: {
				where: { entity_id: { eq: entityId }, status: { eq: 'SEALED' } },
				fields: [
					'employee_number',
					'employee_id',
					'entity_id',
					'effective_range',
					'service_started_on',
					'employee_extension_data',
					'events',
					'family',
					'terms'
				],
				order_by: { employee_number: 'asc' },
				limit: 10000,
				employee_id: { fields: ['name', 'cumulative_service'] },
				entity_id: { fields: ['settings_code'] }
			}
		})
	);
	const contract = $derived(
		(contracts.current?.employee_contract.rows ?? []).find((row) => row.id === chosen) ?? null
	);
	// leave is taken under the law in force today, in the lineage of the contract's entity
	const code = $derived(contract?.entity_id?.settings_code);
	const versions = $derived(
		code === undefined
			? null
			: ctx.query({
					jurisdiction_settings: {
						where: { code: { eq: code }, status: { eq: 'SEALED' } },
						fields: ['id', 'code', 'effective_range'],
						limit: 1000
					}
				})
	);
	const inForce = $derived(
		versionOn(versions?.current?.jurisdiction_settings.rows ?? [], code, String(today))
	);
	const catalogs = $derived(
		inForce == null
			? null
			: ctx.query({
					leave_catalog: {
						// a filed entry keeps its own leave type, even one of an earlier version
						where:
							fixedCatalog && catalogId != null
								? { or: [{ settings_id: { eq: inForce.id } }, { id: { eq: catalogId } }] }
								: { settings_id: { eq: inForce.id } },
						fields: ['code', 'lookup'],
						order_by: { code: 'asc' },
						limit: 10000
					}
				})
	);
	// the person's stints, for the service start their windows count from
	const stints = $derived(
		contract?.employee_id == null
			? null
			: ctx.query({
					employee_contract: {
						where: { employee_id: { eq: contract.employee_id.id }, status: { eq: 'SEALED' } },
						fields: ['employee_id', 'status', 'effective_range', 'entity_id'],
						limit: 1000,
						entity_id: { fields: ['settings_code'] }
					}
				})
	);
	const balance = $derived(
		chosen === null || contract?.employee_id == null
			? null
			: ctx.query({
					employee_balance: {
						where: { employee_id: { eq: contract.employee_id.id } },
						fields: ['account'],
						limit: 1
					}
				})
	);
	const leaveAccount = $derived(
		accountsOf(balance?.current?.employee_balance.rows[0]?.account ?? {})
	);
	const subject = $derived.by(() => {
		if (contract === null || inForce === undefined) return null;
		const { chain, lineage } = chainOf(
			(stints?.current?.employee_contract.rows ?? []).map(jsonObject)
		);
		const own = chain.find((row) => row.id === contract.id);
		return own === undefined
			? null
			: {
					scope: String(inForce.code),
					started: startsOf(own, chain, lineage, contract.employee_id?.cumulative_service === true)
						.service_started_on,
					events: eventsOf(jsonObject(contract))
				};
	});
	const recordDays = $derived(
		entry == null ? 0 : (captures?.current?.leave_catalog_entry_day.rows.length ?? 0) / 2
	);
	const availableFor = (row: {
		readonly id: string;
		readonly code: string;
		readonly lookup?: unknown;
	}) => {
		const lookup = jsonObject(row.lookup ?? {});
		if (unlimited(lookup)) return Infinity;
		const target = Array.isArray(lookup.accounts) ? lookup.accounts.find(isJsonObject) : undefined;
		const code = typeof target?.code === 'string' ? target.code : row.code;
		const counted = jsonObject(catalogRows.find((item) => item.code === code)?.lookup ?? lookup);
		const left =
			subject === null ? 0 : leftOn(leaveAccount, 'leave', code, counted, subject, String(today));
		// a row that counts in hours offers them as days of the contract's normal day
		const dayHours = counted.unit === 'HOUR' ? (contract?.terms.normal_hours_per_day ?? 0) : 0;
		return (
			(dayHours > 0 ? left / dayHours : left) +
			(entry != null && catalogId === row.id ? recordDays : 0)
		);
	};
	const isNoCap = (row: { readonly lookup?: unknown }) => unlimited(jsonObject(row.lookup ?? {}));
	const catalogRows = $derived(catalogs?.current?.leave_catalog.rows ?? []);
	const catalogOptions = $derived(
		catalogRows
			.filter((row) => availableFor(row) > 0)
			.map((row) => ({
				value: row.id,
				label: row.code,
				suffix: isNoCap(row) ? '' : `${availableFor(row)} d`
			}))
	);
	const monthKey = $derived(
		`${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`
	);
	const monthEnd = $derived(String(month_of(`${monthKey}-01`).to));
	const dates = $derived(each_day(date_period(`${monthKey}-01`, monthEnd)).map(String));
	const holidays = $derived(
		ctx.query({
			holiday: {
				where: {
					entity_id: { eq: entityId },
					date: { gte: plain_date(`${monthKey}-01`), lte: plain_date(monthEnd) },
					published_at: { is_null: false },
					employee_id: { is_null: true }
				},
				fields: ['date', 'name'],
				limit: 10000
			}
		})
	);
	const holidayByDate = $derived(
		new Map((holidays.current?.holiday.rows ?? []).map((row) => [String(row.date), row.name]))
	);
	const occupied = $derived(
		chosen === null
			? new Set<string>()
			: new Set(
					(
						ctx.query({
							leave_catalog_entry: {
								where: { employment_id: { eq: chosen } },
								fields: ['id', 'employment_id'],
								limit: 10000,
								leave_catalog_entry_day: {
									fields: ['id', 'incurred_on', 'part', 'payroll_run_id'],
									limit: 10000
								}
							}
						}).current?.leave_catalog_entry.rows ?? []
					)
						.filter((row) => row.id !== entry)
						.flatMap((row) =>
							(row.leave_catalog_entry_day ?? []).flatMap((child) => {
								const date = String(child.incurred_on ?? '');
								const part = String(child.part ?? '');
								return date !== '' ? [`${date}:${part}`] : [];
							})
						)
				)
	);
	const weekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
	// an entry's days may run across the person's contract versions: any stint answers for its dates
	const employed = (date: string) =>
		(stints?.current?.employee_contract.rows ?? []).some(
			({ effective_range: range }) =>
				String(range.from) <= date && (range.to == null || date <= String(range.to))
		);
	const blocked = (date: string) => weekend(date) || holidayByDate.has(date) || !employed(date);
	// a half-day a payroll run paid: it may still be removed, and the next run carries the difference
	const isSealed = (date: string, part: 'AM' | 'PM') => sealed.has(`${date}:${part}`);
	const selected = (date: string, part: 'AM' | 'PM') =>
		sessions.some((row) => row.date === date && row.part === part);
	const chosenCatalog = $derived(catalogRows.find((row) => row.id === catalog) ?? null);
	const availableDays = $derived(chosenCatalog === null ? 0 : availableFor(chosenCatalog));
	const selectedDays = $derived(sessions.length / 2);
	const overLimit = $derived(selectedDays > availableDays);
	let limitNotice = $state<string | null>(null);
	const toggle = (date: string, part: 'AM' | 'PM') => {
		if (catalog === null || blocked(date) || occupied.has(`${date}:${part}`)) return;
		if (selected(date, part)) {
			sessions = sessions.filter((row) => row.date !== date || row.part !== part);
			limitNotice = null;
			return;
		}
		if (selectedDays + 0.5 > availableDays) {
			limitNotice = `Only ${availableDays} day(s) available for this leave type.`;
			return;
		}
		sessions = [...sessions, { date, part }].sort((a, b) => a.date.localeCompare(b.date));
		limitNotice = null;
	};
	const submit = () => {
		if (saving || chosen === null || catalog === null || sessions.length === 0) return;
		saving = true;
		const filed = entry;
		type Saving = ReturnType<typeof ctx.act>;
		const effect: Effect.Effect<Effect.Success<Saving> | null, Effect.Error<Saving>> = filed == null
			? ctx.act({
					'leave_catalog_entry.create': [
						{
							entity_id: entityId,
							employment_id: chosen,
							catalog_id: catalog,
							leave_catalog_entry_day: sessions.map((session) => ({
								incurred_on: plain_date(session.date),
								part: session.part
							}))
						}
					]
				})
			: (() => {
					const existing = captures?.current?.leave_catalog_entry_day.rows ?? [];
					const keep = new Set(sessions.map((session) => `${session.date}:${session.part}`));
					const remove = existing.filter(
						(row) => !keep.has(`${String(row.incurred_on)}:${row.part}`)
					);
					const add = sessions.filter(
						(session) =>
							!existing.some(
								(row) => String(row.incurred_on) === session.date && row.part === session.part
							)
					);
					const filedRow = captures?.current?.leave_catalog_entry.rows[0];
					if (filedRow === undefined) return Effect.succeed(null);
					return ctx.act({
						'leave_catalog_entry.update': [
							{
								target: filedRow,
								set: {
									leave_catalog_entry_day: {
										delete: remove,
										create: add.map((session) => ({
											incurred_on: plain_date(session.date),
											part: session.part
										}))
									}
								}
							}
						]
					});
				})();
		// a half-day a run paid that goes, or any half-day dated in a paid period, is a correction: the save asks first
		const existing = captures?.current?.leave_catalog_entry_day.rows ?? [];
		const kept = new Set(sessions.map((session) => `${session.date}:${session.part}`));
		const corrects =
			existing.some(
				(row) => row.payroll_run_id != null && !kept.has(`${String(row.incurred_on)}:${row.part}`)
			) ||
			sessions.some(
				(session) =>
					paid.covers(session.date) &&
					!existing.some(
						(row) => String(row.incurred_on) === session.date && row.part === session.part
					)
			);
		const asked = corrects
			? confirm_action({
					title: 'This period is already paid',
					body: PAID_NOTE,
					confirm_label: 'Save correction'
				})
			: Effect.succeed(true);
		fork(
			asked.pipe(
				Effect.flatMap((proceed) => (proceed ? effect : Effect.succeed(null))),
				Effect.tap((outcome) =>
					Effect.sync(() => {
						if (outcome !== null) notify_outcome(ctx, outcome);
					})
				),
				Effect.tap((outcome) =>
					Effect.sync(() => {
						if (outcome !== null) onDone?.();
					})
				),
				Effect.catch((error) =>
					Effect.sync(() =>
						// a registered rule speaks to the HR controller; its code is for the log
						toast.error(
							error instanceof Error
								? error.message.replace(/^[A-Z0-9_]+\.validate: /, '')
								: ctx.t('component.error')
						)
					)
				),
				Effect.ensuring(Effect.sync(() => (saving = false)))
			)
		);
	};
	const shiftMonth = (delta: number) =>
		(at = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + delta, 1)));
	const monthLabel = $derived(
		new Intl.DateTimeFormat(ctx.locale, {
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(at)
	);
	const weekday = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
	const PARTS = ['AM', 'PM'] as const;
</script>

<Stack gap="md">
	<div class="grid gap-3 sm:grid-cols-2">
		{#if showPerson}<Stack gap="xs">
				<span class="text-xs font-medium text-muted-foreground">Employment</span>
				<Picker
					{ctx}
					of="employee_contract"
					where={{ entity_id: { eq: entityId }, status: { eq: 'SEALED' } }}
					value={chosen}
					disabled={fixedEmployment}
					on_change={(value) => {
						chosen = value;
						catalog = null;
						sessions = [];
						limitNotice = null;
					}}
				/>
			</Stack>{/if}
		<Stack gap="xs" class={showPerson ? 'relative' : 'relative sm:col-span-2'}>
			<span class="text-xs font-medium text-muted-foreground">Catalog</span>
			<Combobox
				options={catalogOptions}
				value={catalog}
				placeholder="Select leave type"
				aria-label="Leave type"
				disabled={fixedCatalog}
				on_change={(value) => {
					catalog = value;
					limitNotice = null;
				}}
			/>
			{#if chosenCatalog !== null && !isNoCap(chosenCatalog)}<span
					class="pointer-events-none absolute top-6 right-9 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground"
					>{availableDays} d left</span
				>{/if}
		</Stack>
	</div>

	{#if editable}<p class="text-xs text-muted-foreground">
			Tap a half-day to select or deselect it. Filled buttons are selected; dimmed days are
			unavailable.
		</p>{/if}
	<div class="rounded-xl border">
		<Cluster justify="between" class="border-b px-3 py-2">
			<Button variant="ghost" onclick={() => shiftMonth(-1)}>‹</Button>
			<span class="text-sm font-medium">{monthLabel}</span>
			<Button variant="ghost" onclick={() => shiftMonth(1)}>›</Button>
		</Cluster>
		<div
			class="grid grid-cols-7 border-b bg-muted/40 text-center text-[10px] font-medium text-muted-foreground"
		>
			{#each weekday as day, index (index)}<span class="py-1">{day}</span>{/each}
		</div>
		<div class="grid grid-cols-7">
			{#each dates as date, index (date)}
				{@const holiday = holidayByDate.get(date)}
				<div
					class="flex min-h-24 flex-col border-b border-r p-1 text-xs last:border-r-0"
					style:grid-column-start={index === 0
						? new Date(`${date}T00:00:00Z`).getUTCDay() + 1
						: undefined}
					class:bg-muted={weekend(date) || holiday != null}
					class:opacity-40={blocked(date)}
					title={holiday}
				>
					<span class="block text-[10px] tabular-nums text-muted-foreground"
						>{Number(date.slice(8))}</span
					>
					<div class="mt-1 flex flex-1 gap-0.5">
						{#each PARTS as part (part)}
							<button
								type="button"
								aria-label={`${date} ${part}`}
								aria-pressed={selected(date, part)}
								disabled={!editable ||
									catalog === null ||
									blocked(date) ||
									occupied.has(`${date}:${part}`) ||
									(!selected(date, part) && selectedDays >= availableDays)}
								class="min-h-10 flex-1 rounded-md border px-0.5 py-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-30 {selected(
									date,
									part
								)
									? 'border-foreground bg-foreground font-medium text-background'
									: 'border-border text-muted-foreground hover:border-foreground hover:bg-muted'}"
								title={entry != null && isSealed(date, part)
									? 'A payroll run paid this half-day. Removing it is carried by the next run.'
									: undefined}
								onclick={() => toggle(date, part)}
							>
								{part}
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</div>

	<Cluster justify="between">
		<span
			class={overLimit || limitNotice !== null
				? 'text-xs text-destructive'
				: 'text-xs text-muted-foreground'}
		>
			{limitNotice ??
				(editable && Number.isFinite(availableDays)
					? `${selectedDays} of ${availableDays} day(s) selected`
					: `${selectedDays} day(s)`)}
		</span>
		{#if editable}<Cluster gap="sm">
				{#if entry == null}<Button variant="secondary" onclick={onDone} disabled={saving}
						>Cancel</Button
					>{/if}
				<Button
					onclick={submit}
					disabled={saving || sessions.length === 0 || catalog === null || overLimit}
				>
					{entry != null ? 'Save days' : 'Request leave'}
				</Button>
			</Cluster>{/if}
	</Cluster>
</Stack>
