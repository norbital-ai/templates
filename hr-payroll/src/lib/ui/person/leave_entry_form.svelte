<script lang="ts">
	import { bolt } from '$bolt';
	import type { Id, Row } from '@norbital-ai/bolt';
	import { Effect } from 'effect';
	import { untrack } from 'svelte';
	import { PlainDate, datePeriod, eachDay, monthOf } from '@norbital-ai/std/date';
	import { Button, Combobox, notifyOutcome, toast } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { fork } from '@norbital-ai/ui/effect';
	import { todayKey } from '../format/calendar.js';
	import { accountsOf, eventsOf, leftOn } from '../../ledger/core.js';
	import { isJsonObject, jsonObject } from '../../payroll_engine/foundation.js';
	import { idOf } from '../../payroll_engine/reads.js';
	import ReversalEditor from './reversal_editor.svelte';

	type LeaveSlot = {
		readonly id: Id<'leave_catalog_entry_day'>;
		readonly incurred_on: string | PlainDate;
		readonly part: 'AM' | 'PM';
		readonly payroll_run_id?: unknown;
	};

	let {
		entityId,
		employmentId: initialEmployment,
		record = null,
		allowReversal = false,
		reverses = null,
		encashment = false,
		catalogId = null,
		onDone
	}: {
		entityId: Id<'entity'>;
		employmentId?: Id<'employee_contract'> | null;
		/** The sealed entry a new reversal corrects, when the page opens straight into reversal mode. */
		reverses?: Id<'leave_catalog_entry'> | null;
		/** The corrected entry was a cash-out: its reversal must carry the flag or it only returns the days. */
		encashment?: boolean;
		catalogId?: Id<'leave_catalog'> | null;
		record?:
			| (Row<'leave_catalog_entry'> & {
					readonly leave_catalog_entry_day?: readonly LeaveSlot[];
			  })
			| null;
		/** The HR controller corrects what has been paid with a reversal entry on the same item. */
		allowReversal?: boolean;
		onDone: () => void;
	} = $props();

	const fixedEmployment = initialEmployment != null;
	const clock = bolt.clock('day');
	const today = $derived(clock.today || todayKey());
	const [year, month] = today.split('-').map(Number) as [number, number];
	let at = $state(new Date(Date.UTC(year, month - 1, 1)));
	let chosen = $state<Id<'employee_contract'> | null>(initialEmployment ?? null);
	let catalog = $state<Id<'leave_catalog'> | null>(
		(record?.catalog_id as Id<'leave_catalog'> | undefined) ?? catalogId ?? null
	);
	let sessions = $state<{ date: string; part: 'AM' | 'PM' }[]>(
		record === null
			? []
			: (record.leave_catalog_entry_day ?? []).flatMap((child) => {
					const date = String(child.incurred_on ?? '');
					const part = String(child.part ?? '');
					return date !== '' && (part === 'AM' || part === 'PM') ? [{ date, part }] : [];
				})
	);
	let saving = $state(false);
	// a reversal returns exactly the slots a run captured; opening one preselects them all
	let originalSlots = $state<ReadonlySet<string>>(new Set());
	let loadedReversal = $state<string | null>(null);
	$effect(() => {
		const id = reversing;
		if (id === null || record !== null || id === loadedReversal) return;
		loadedReversal = id;
		untrack(() => {
			void (async () => {
				const key = idOf('leave_catalog_entry', id);
				const answer = await bolt.query({
					leave_catalog_entry_day: {
						where: { leave_entry_id: { eq: key } },
						fields: ['incurred_on', 'part', 'payroll_run_id'],
						orderBy: { incurred_on: 'asc' },
						limit: 10000
					},
					leave_catalog_entry: {
						where: { id: { eq: key } },
						fields: ['catalog_id'],
						limit: 1
					}
				});
				const ref = (value: unknown): string => {
					if (typeof value === 'string') return value;
					if (value !== null && typeof value === 'object' && 'id' in value)
						return String((value as { readonly id: unknown }).id);
					return '';
				};
				const original = answer.leave_catalog_entry.rows[0];
				if (original !== undefined) {
					const catalogId = ref(original.catalog_id);
					if (catalogId !== '') catalog = idOf('leave_catalog', catalogId);
				}
				const slots = answer.leave_catalog_entry_day.rows
					.filter((row) => row.payroll_run_id != null)
					.flatMap((row) => {
						const date = String(row.incurred_on ?? '');
						const part = String(row.part ?? '');
						return date !== '' && (part === 'AM' || part === 'PM')
							? [{ date, part: part as 'AM' | 'PM' }]
							: [];
					});
				originalSlots = new Set(slots.map((slot) => `${slot.date}:${slot.part}`));
				sessions = slots;
				if (slots[0] !== undefined) at = new Date(`${slots[0].date.slice(0, 7)}-01T00:00:00Z`);
			})();
		});
	});

	const contracts = $derived(
		bolt.query({
			employee_contract: {
				where: { entity_id: { eq: entityId }, status: { eq: 'SEALED' } },
				fields: [
					'employee_number',
					'employee_name',
					'employee_id',
					'entity_id',
					'input_schema_version_id',
					'effective_range',
					'service_started_on',
					'employee_extension_data'
				],
				orderBy: { employee_number: 'asc' },
				limit: 10000
			}
		})
	);
	const contractOptions = $derived(
		(contracts.current?.employee_contract.rows ?? []).map((row) => ({
			value: row.id,
			label: `${row.employee_name} · ${row.employee_number} · ${row.effective_range.from} to ${row.effective_range.to ?? 'now'}`
		}))
	);
	const contract = $derived(
		(contracts.current?.employee_contract.rows ?? []).find((row) => row.id === chosen) ?? null
	);
	const settings = $derived(
		contract === null
			? null
			: bolt.query({
					jurisdiction_settings: {
						where: { id: { eq: contract.input_schema_version_id } },
						fields: ['id', 'code'],
						limit: 1
					}
				})
	);
	// leave is taken under the law in force, not the version the contract started on
	const versions = $derived(
		settings?.current?.jurisdiction_settings.rows[0] == null
			? null
			: bolt.query({
					jurisdiction_settings: {
						where: {
							code: { eq: settings.current.jurisdiction_settings.rows[0]!.code },
							status: { eq: 'SEALED' }
						},
						fields: ['id', 'effective_range'],
						limit: 1000
					}
				})
	);
	const inForce = $derived(
		versions?.current?.jurisdiction_settings.rows.find(
			({ effective_range: range }) =>
				String(range.from) <= String(today) &&
				(range.to == null || String(today) <= String(range.to))
		) ?? settings?.current?.jurisdiction_settings.rows[0]
	);
	const catalogs = $derived(
		inForce == null
			? null
			: bolt.query({
					leave_catalog: {
						where: { settings_id: { eq: inForce.id } },
						fields: ['code', 'lookup'],
						orderBy: { code: 'asc' },
						limit: 10000
					}
				})
	);
	const balance = $derived(
		chosen === null || contract === null
			? null
			: bolt.query({
					employee_balance: {
						where: { employee_id: { eq: contract.employee_id } },
						fields: ['account'],
						limit: 1
					}
				})
	);
	const leaveAccount = $derived(
		accountsOf(balance?.current?.employee_balance.rows[0]?.account ?? {})
	);
	const subject = $derived(
		contract === null || inForce == null
			? null
			: {
					scope: String(settings?.current?.jurisdiction_settings.rows[0]?.code),
					started: String(contract.service_started_on ?? contract.effective_range.from),
					events: eventsOf(jsonObject(contract))
				}
	);
	const recordDays = $derived((record?.leave_catalog_entry_day?.length ?? 0) / 2);
	const availableFor = (row: {
		readonly id: string;
		readonly code: string;
		readonly lookup?: unknown;
	}) => {
		const lookup = jsonObject(row.lookup ?? {});
		const target = Array.isArray(lookup.accounts) ? lookup.accounts.find(isJsonObject) : undefined;
		const code = typeof target?.code === 'string' ? target.code : row.code;
		const counted = jsonObject(catalogRows.find((item) => item.code === code)?.lookup ?? lookup);
		const left =
			subject === null ? 0 : leftOn(leaveAccount, 'leave', code, counted, subject, String(today));
		return left + (record?.catalog_id === row.id ? recordDays : 0);
	};
	// a row with no figure has no cap
	const isNoCap = (row: { readonly lookup?: unknown }) => {
		const lookup = (row.lookup ?? {}) as {
			readonly no_cap?: boolean;
			readonly grant_days?: number;
			readonly service_bands?: unknown;
		};
		return lookup.no_cap === true || (lookup.grant_days == null && lookup.service_bands == null);
	};
	const catalogRows = $derived(catalogs?.current?.leave_catalog.rows ?? []);
	let reversal = $state(reverses != null);
	let reversing = $state<string | null>(reverses ?? null);
	const catalogOptions = $derived(
		catalogRows
			.filter((row) => reversal || availableFor(row) > 0)
			.map((row) => ({
				value: row.id,
				label: row.code,
				suffix: reversal || isNoCap(row) ? '' : `${availableFor(row)} d`
			}))
	);
	const monthKey = $derived(
		`${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`
	);
	const monthEnd = $derived(String(monthOf(`${monthKey}-01`).to));
	const dates = $derived(eachDay(datePeriod(`${monthKey}-01`, monthEnd)).map(String));
	const holidays = $derived(
		bolt.query({
			holiday: {
				where: {
					entity_id: { eq: entityId },
					date: { gte: PlainDate(`${monthKey}-01`), lte: PlainDate(monthEnd) },
					published_at: { isNull: false }
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
						bolt.query({
							leave_catalog_entry: {
								where: { employment_id: { eq: chosen } },
								fields: ['id', 'employment_id'],
								limit: 10000
							},
							'leave_catalog_entry.leave_catalog_entry_day': {
								fields: ['id', 'incurred_on', 'part', 'payroll_run_id'],
								limit: 10000
							}
						}).current?.leave_catalog_entry.rows ?? []
					)
						.filter((row) => row.id !== record?.id)
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
	const blocked = (date: string) =>
		weekend(date) ||
		holidayByDate.has(date) ||
		date < String(contract?.effective_range.from ?? '') ||
		(contract?.effective_range.to != null && date > String(contract.effective_range.to));
	const captures = $derived(
		record === null
			? null
			: bolt.query({
					leave_catalog_entry_day: {
						where: { leave_entry_id: { eq: record.id } },
						fields: ['id', 'incurred_on', 'part', 'payroll_run_id'],
						limit: 10000
					}
				})
	);
	const captured = $derived(
		new Set(
			(captures?.current?.leave_catalog_entry_day.rows ?? []).map(
				(row) => `${String(row.incurred_on)}:${row.part}`
			)
		)
	);
	const isCaptured = (date: string, part: 'AM' | 'PM') => captured.has(`${date}:${part}`);
	const selected = (date: string, part: 'AM' | 'PM') =>
		sessions.some((row) => row.date === date && row.part === part);
	const chosenCatalog = $derived(catalogRows.find((row) => row.id === catalog) ?? null);
	const availableDays = $derived(chosenCatalog === null ? 0 : availableFor(chosenCatalog));
	const selectedDays = $derived(sessions.length / 2);
	const overLimit = $derived(!reversal && selectedDays > availableDays);
	let limitNotice = $state<string | null>(null);
	const toggle = (date: string, part: 'AM' | 'PM') => {
		if (catalog === null || blocked(date) || (!reversal && occupied.has(`${date}:${part}`))) return;
		if (reversal && !selected(date, part) && !originalSlots.has(`${date}:${part}`)) return;
		if (selected(date, part)) {
			sessions = sessions.filter((row) => row.date !== date || row.part !== part);
			limitNotice = null;
			return;
		}
		if (!reversal && selectedDays + 0.5 > availableDays) {
			limitNotice = `Only ${availableDays} day(s) available for this leave type.`;
			return;
		}
		sessions = [...sessions, { date, part }].sort((a, b) => a.date.localeCompare(b.date));
		limitNotice = null;
	};
	const submit = () => {
		if (saving || chosen === null || catalog === null || sessions.length === 0) return;
		if (reversal && reversing === null) return;
		saving = true;
		const effect =
			record === null
				? bolt.act('leave_catalog_entry.create', [
						{
							entity_id: entityId,
							employment_id: chosen,
							catalog_id: catalog,
							leave_catalog_entry_day: sessions.map((session) => ({
								incurred_on: PlainDate(session.date),
								part: session.part
							})),
							...(reversal && reversing !== null
								? {
										reverses: idOf('leave_catalog_entry', reversing),
										...(encashment ? { encashment: true } : {})
									}
								: {})
						}
					])
				: (() => {
						const existing = captures?.current?.leave_catalog_entry_day.rows ?? [];
						const keep = new Set(sessions.map((session) => `${session.date}:${session.part}`));
						const remove = existing.filter(
							(row) =>
								row.payroll_run_id == null &&
								!keep.has(`${String(row.incurred_on)}:${row.part}`)
						);
						const add = sessions.filter(
							(session) =>
								!existing.some(
									(row) =>
										String(row.incurred_on) === session.date && row.part === session.part
								)
						);
						return bolt.act('leave_catalog_entry.update', [
							{
								target: record.id,
								set: {
									leave_catalog_entry_day: {
										delete: remove.map((row) => row.id),
										create: add.map((session) => ({
											incurred_on: PlainDate(session.date),
											part: session.part
										}))
									}
								}
							}
						]);
					})();
		fork(
			effect.pipe(
				Effect.tap((outcome) => Effect.sync(() => notifyOutcome(bolt, outcome))),
				Effect.tap(() => Effect.sync(() => onDone())),
				Effect.catch((error) =>
					Effect.sync(() =>
						// a registered rule speaks to the HR controller; its code is for the log
						toast.error(
							error instanceof Error
								? error.message.replace(/^[A-Z0-9_]+\.validate: /, '')
								: bolt.t('component.error')
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
		new Intl.DateTimeFormat(bolt.locale, {
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(at)
	);
	const weekday = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
	const PARTS = ['AM', 'PM'] as const;
</script>

<Stack gap="md">
	{#if allowReversal && record === null}
		<label class="flex items-start gap-2 text-sm">
			<input
				type="checkbox"
				class="mt-1"
				checked={reversal}
				onchange={(event) => {
					reversal = event.currentTarget.checked;
					reversing = null;
					loadedReversal = null;
					originalSlots = new Set();
					catalog = null;
					sessions = [];
					limitNotice = null;
				}}
			/>
			<span>
				Reversal of leave already paid
				<span class="block text-xs text-muted-foreground">
					Pick the leave type and the sealed entry it reverses, then the days, dated in the next
					period to run. That run pays it back. An entry no run has sealed is deleted instead.
				</span>
			</span>
		</label>
	{/if}
	<div class="grid gap-3 sm:grid-cols-2">
		{#if !fixedEmployment}<Stack gap="xs">
			<span class="text-xs font-medium text-muted-foreground">Employment</span>
			<Combobox
				options={contractOptions}
				value={chosen}
				placeholder="Select employment"
				aria-label="Employment"
				onChange={(value) => {
					chosen = value;
					catalog = null;
					sessions = [];
					limitNotice = null;
				}}
			/>
		</Stack>{/if}
		<Stack gap="xs" class={fixedEmployment ? 'relative sm:col-span-2' : 'relative'}>
			<span class="text-xs font-medium text-muted-foreground">Catalog</span>
			<Combobox
				options={catalogOptions}
				value={catalog}
				placeholder="Select leave type"
				aria-label="Leave type"
				onChange={(value) => {
					catalog = value;
					reversing = null;
					limitNotice = null;
				}}
			/>
			{#if chosenCatalog !== null && !reversal && !isNoCap(chosenCatalog)}<span
					class="pointer-events-none absolute top-6 right-9 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground"
					>{availableDays} d left</span
				>{/if}
		</Stack>
		{#if reversal}<Stack gap="xs">
				<span class="text-xs font-medium text-muted-foreground">Entry reversed</span>
				<ReversalEditor
					family="leave"
					employment={chosen}
					{catalog}
					value={reversing}
					onChange={(value) => (reversing = value)}
				/>
			</Stack>{/if}
	</div>

	<p class="text-xs text-muted-foreground">
		{reversal
			? 'Only the half-days this run paid can be reversed. Filled buttons are selected; dimmed days cannot be chosen.'
			: 'Tap a half-day to select or deselect it. Filled buttons are selected; dimmed days are unavailable.'}
	</p>
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
			{#each dates as date (date)}
				{@const holiday = holidayByDate.get(date)}
				<div
					class="flex min-h-24 flex-col border-b border-r p-1 text-xs last:border-r-0"
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
								disabled={catalog === null ||
									blocked(date) ||
									(selected(date, part) && isCaptured(date, part)) ||
									(!reversal &&
										(occupied.has(`${date}:${part}`) ||
											(!selected(date, part) && selectedDays >= availableDays)))}
								class="min-h-10 flex-1 rounded-md border px-0.5 py-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-30 {selected(
									date,
									part
								)
									? 'border-foreground bg-foreground font-medium text-background'
									: 'border-border text-muted-foreground hover:border-foreground hover:bg-muted'}"
								title={isCaptured(date, part) ? 'Captured by payroll; create a reversal to cancel.' : undefined}
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
				(reversal
					? `${selectedDays} day(s) to reverse`
					: `${selectedDays} of ${availableDays} day(s) selected`)}
		</span>
		<Cluster gap="sm">
			<Button variant="secondary" onclick={onDone} disabled={saving}>Cancel</Button>
			<Button
				onclick={submit}
				disabled={saving ||
					sessions.length === 0 ||
					catalog === null ||
					overLimit ||
					(reversal && reversing === null)}
			>
				{record !== null ? 'Save days' : reversal ? 'Reverse leave' : 'Request leave'}
			</Button>
		</Cluster>
	</Cluster>
</Stack>
