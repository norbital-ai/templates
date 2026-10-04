<script lang="ts">
 import { bolt } from '$bolt';
 import type { Id } from '@norbital-ai/bolt';
 import { Schema } from 'effect';
 import * as Predicate from 'effect/Predicate';
 import { PlainDate } from '@norbital-ai/std/date';
 import { AppShell, Cluster, Columns, Stack } from '@norbital-ai/ui/layout';
 import { Table } from '@norbital-ai/ui';
 import { liveRows, live } from '../../../lib/ui/state/live.svelte.js';
 import { employeeMissingPunchReportable, slotFill, plannedExtraLabel, describeDay, resolveCellLayers, unresolvedClockOutEmploymentIds, assessAttendanceDraft, attendanceChanged, daySaveIntent, daySaveLabelKey, clockToDayMinutes, instantFromDayStart, minutesFromDayStart, dayMinutesToClock, dayMinutesOffsetDays, type AttendanceCell } from './attendance-state.js';
 import { formatSettingsRange } from '../../../lib/ui/scopes/settings-scope.js';
 import { todayKey } from '../../../lib/ui/format/calendar.js';
 import CompanyScope from '../../../lib/ui/scopes/CompanyScope.svelte';
 import { companyScope } from '../../../lib/ui/scopes/company-scope.svelte.js';
 import { runWorkbookImport } from '../../../lib/ui/workbook/workbook-import.js';
 import { schedulingTemplateWorkbook } from './attendance-template.js';
 import { schedulingImportPayload, attendanceWorkbookRequest } from './attendance-workbook.js';
 import { getErrorMessage } from '../../../lib/payroll_engine/foundation.js';
 const scope = companyScope();

 type BoardCell = AttendanceCell & { employmentId: Id<'employment_contract'>; snapshot_id: Id<'jurisdiction_settings'>; base:{code:string;kind:string;patternCode:string|null}|null;override:{code:string;kind:string}|null;effective:string; snapshot_range: {from:string;to:string|null}; configuration_hash: string; timezone: string; projected_shift_id: string | null; lock_rung: string; writable: boolean; holidayName:string|null;holidayFrom:string|null;holiday: boolean; shift_options: { id: string; code: string; kind: string; start_time: string | null; end_time: string | null; break_minutes: number | null }[] };
 const narration = (key:string,parameters:Record<string,unknown>={}) => bolt.t(key as Parameters<typeof bolt.t>[0], Object.fromEntries(Object.entries(parameters).map(([key,value])=>[key,String(value)])));
 let month = $state(String(todayKey()).slice(0, 7));
 let profileId = $state<Id<'employment_contract'> | ''>('');
 const profiles = liveRows(() => scope.id == null ? null : bolt.read('employment_contract', { where: { company_id: { eq: scope.id }, approval_id: { isNull: true } }, select: { id: true, employee_id: true }, all: true }));
 const board = live(() => scope.id == null || !profileId || !(profiles.current ?? []).some(profile => profile.id === profileId) ? null : bolt.query('roster_entries.attendance_month', { profile_id: profileId, month }), ['employment_contract', 'entity', 'roster_entry', 'rosters', 'payslips', 'payroll_run', 'jurisdiction_settings', 'work_catalog', 'holiday']);
 const boardValue = (value: unknown): { cells: BoardCell[]; observed_day: string } | undefined => {
  if (!Predicate.isObject(value) || !Predicate.isString(value.observed_day) || !Array.isArray(value.cells)) return undefined;
  return { cells: value.cells as BoardCell[], observed_day: value.observed_day };
 };
 const result = $derived(boardValue(board.current));
 let unresolvedOnly = $state(false);
 const visibleCells = $derived((result?.cells ?? []).filter(cell => !unresolvedOnly || unresolvedClockOutEmploymentIds(result?.cells ?? []).has(cell.employmentId)));
 let selected = $state<BoardCell | null>(null);
 let assigned = $state('');
 let attendanceKnown = $state(false);
 let punches = $state<{ start: string; startDay: number; end: string; endDay: number }[]>([]);
 let saving = $state(false);
 let failure = $state('');
 function openDay(cell: BoardCell) {
  selected = cell; assigned = cell.shiftCode ?? ''; attendanceKnown = cell.intervals != null; failure = '';
  punches = (cell.intervals ?? []).map(interval => {
   const start = minutesFromDayStart(interval.start, cell.date, cell.timezone), end = interval.end == null ? null : minutesFromDayStart(interval.end, cell.date, cell.timezone);
   return { start: dayMinutesToClock(start), startDay: dayMinutesOffsetDays(start), end: end == null ? '' : dayMinutesToClock(end), endDay: end == null ? 0 : dayMinutesOffsetDays(end) };
  });
 }
 const draft = $derived.by(() => {
  if (selected == null || !attendanceKnown) return null;
  return punches.map(punch => {
   const start = clockToDayMinutes(punch.start, punch.startDay), end = punch.end === '' ? null : clockToDayMinutes(punch.end, punch.endDay);
   if (start == null || punch.end !== '' && end == null) return { start: '', end: '' };
   return { start: instantFromDayStart(selected!.date, start, selected!.timezone), end: end == null ? null : instantFromDayStart(selected!.date, end, selected!.timezone) };
  });
 });
 const headroom = live(() => selected == null ? null : bolt.query('roster_entries.attendance_overtime_headroom', { profile_id: selected.employmentId, work_date: PlainDate(selected.date), ...(assigned === '' ? {} : { shift_code: assigned }) }), ['roster_entry', 'employment_contract', 'entity', 'jurisdiction_settings', 'work_catalog', 'rule_set', 'holiday']);
 const headroomValue = (value: unknown): { hours: number | null; limit: { key: string } | null } | undefined => {
  if (!Predicate.isObject(value)) return undefined;
  const limit = Predicate.isObject(value.limit) && Predicate.isString(value.limit.key) ? { key: value.limit.key } : null;
  return { hours: Predicate.isNumber(value.hours) ? value.hours : null, limit };
 };
 const overtimeRoom = $derived(headroomValue(headroom.current));
 const assessment = $derived(draft == null ? null : assessAttendanceDraft(draft, selected?.shift_options.find(shift => shift.code === assigned)?.break_minutes ?? null));
 const assignmentDirty = $derived(selected != null && assigned !== (selected.shiftCode ?? ''));
 const attendanceDirty = $derived(selected != null && attendanceChanged({ intervals: selected.intervals, breakMinutes: 0 }, { intervals: draft, breakMinutes: 0 }));
 const intent = $derived(daySaveIntent(assignmentDirty, attendanceDirty));
 async function saveDay() {
  if (selected == null || !selected.writable || intent === 'none' || !(profiles.current ?? []).some(profile => profile.id === selected?.employmentId)) return;
  saving = true; failure = '';
  try {
   // A recorded day must restate its actual clocks when its plan changes. Unrelated days are untouched.
   const replaceAttendance = attendanceDirty || assignmentDirty && selected.intervals != null;
   const outcome = await bolt.act('roster_entries.capture', { profile_id: selected.employmentId, snapshot_id: selected.snapshot_id, configuration_hash: selected.configuration_hash, mode: 'ATTENDANCE_IMPORT', kind: 'MANUAL', work_date: PlainDate(selected.date), replacement: { replace: { attendance: replaceAttendance, roster: assignmentDirty, pieces: false, overtime: false }, row: { ...(assignmentDirty ? { shift_code: assigned || null } : {}), ...(replaceAttendance ? { worked_intervals: draft } : {}) }, file_present: true, import_keys: [] } });
   if (outcome.kind === 'refused') throw new Error(outcome.message);
   if (outcome.kind !== 'committed' && outcome.kind !== 'pendingApproval') throw new Error('Attendance was not committed.');
   selected = null;
  } catch (error) { failure = getErrorMessage(error); }
  finally { saving = false; }
 }

 let importing = $state(false);
 async function downloadTemplate() {
  if (scope.id == null || !scope.company?.name) return;
  failure = '';
  try {
   const metadata = Schema.decodeUnknownSync(Schema.Struct({ timezone: Schema.String, overtimeConsent: Schema.Boolean, factColumns: Schema.Array(Schema.String) }))(await bolt.query('roster_entries.attendance_template_configuration', { entity_id: scope.id, month }));
   const workbook = schedulingTemplateWorkbook({ legalEntity: scope.company.name, month, ...metadata });
   const bytes = await workbook.xlsx.writeBuffer();
   const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
   const anchor = document.createElement('a'); anchor.href = url; anchor.download = `attendance-${month}.xlsx`; anchor.click(); URL.revokeObjectURL(url);
  } catch (error) { failure = getErrorMessage(error); }
 }
 async function importAttendance() {
  if (scope.id == null) return;
  importing = true;
  try {
   const entity_id = scope.id;
   const configuration = await bolt.query('roster_entries.kiosk_configuration', { entity_id });
   await runWorkbookImport({
    action: 'roster_entries.import_attendance', recordLabel: bolt.t('app.scheduling.board_title'),
    buildPayload(grids) {
     const payload = schedulingImportPayload(grids);
      const request = attendanceWorkbookRequest(payload,{entity_id,entity_name:scope.company!.name,...configuration});
     return { ...request, entity_id, snapshot_id: configuration.snapshot_id };
    }
   });
  } finally { importing = false; }
 }
</script>

<AppShell icon="lucide:calendar-clock" title={bolt.t('app.scheduling.board_title')} description="Plan and record attendance across the selected legal entity.">
  {#snippet actions()}<CompanyScope {scope} />{/snippet}
  <Stack gap="md" class="p-4" aria-label="Attendance month" as="section">
   <Cluster gap="md">
   <label>Month <input type="month" bind:value={month} onchange={() => selected = null} /></label>
   <label>Employee profile <select bind:value={profileId} onchange={() => selected = null}><option value="">Select employee</option>{#each profiles.current ?? [] as profile}<option value={profile.id}>{profile.employee_id}</option>{/each}</select></label>
   <button type="button" onclick={downloadTemplate} disabled={scope.id == null}>Download template</button>
       <button type="button" onclick={importAttendance} disabled={importing || scope.id == null}>Import workbook</button>
   </Cluster>
  {#if failure && selected == null}<p role="alert">{failure}</p>{/if}
  {#if board.loading}<p>Loading attendance…</p>{:else if board.error}<p role="alert">{board.error}</p>{:else if result}
   <label><input type="checkbox" bind:checked={unresolvedOnly} /> Only unresolved clock-outs</label>
       <Columns count={7} collapse="none" gap="sm">{#each ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as weekday}<strong>{weekday}</strong>{/each}{#each Array.from({ length: (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7 }) as _}<span></span>{/each}{#each visibleCells as cell}<button type="button" class="rounded border p-2 text-left" onclick={() => openDay(cell)} aria-label={describeDay(cell,cell.date,narration)}><strong>{cell.date.slice(8)}</strong> {cell.holidayName ?? ''}{cell.holidayFrom == null ? '' : ` (from ${cell.holidayFrom})`}<br />{cell.shiftCode ?? 'No shift'} · {cell.designation ?? 'Unplanned'}<br /><small>Base: {cell.base?.code ?? 'None'} · Override: {cell.override?.code ?? 'None'} · Clock: {resolveCellLayers(cell).actual.kind}</small><br />{cell.attendanceState ?? 'Unrecorded'}{cell.workedMinutes == null ? '' : ` · ${cell.workedMinutes} min`}<br />{#if employeeMissingPunchReportable(cell,result.observed_day,new Set(),new Set())}<small>Missing punch</small><br />{/if}<small>{plannedExtraLabel(cell) ?? ''} · {slotFill(cell).kind} · {cell.lock_rung} · {formatSettingsRange(cell.snapshot_range)}</small></button>{/each}</Columns>
  {/if}
  {#if selected}
   <Stack gap="sm" class="rounded border p-4" aria-label={`Attendance ${selected.date}`} as="section">
    <h2>{selected.date} · {selected.lock_rung}</h2>
    {#if headroom.error}<p role="alert">{headroom.error}</p>{:else if overtimeRoom}<p>Approved overtime headroom: {overtimeRoom.hours == null ? 'No configured cap' : `${overtimeRoom.hours} hours`} {overtimeRoom.limit?.key ?? ''}</p>{/if}
    <label>Assignment <select bind:value={assigned} disabled={!selected.writable || saving}><option value="">No explicit assignment</option>{#each selected.shift_options as shift}<option value={shift.code}>{shift.code} · {shift.kind}</option>{/each}</select></label>
    <label><input type="checkbox" bind:checked={attendanceKnown} disabled={!selected.writable || saving} />Attendance reviewed</label>
    {#if attendanceKnown}
     {#each punches as punch, index}
      <Cluster gap="sm"><label>In <input type="time" bind:value={punch.start} disabled={!selected.writable || saving} /></label><label>Day offset <input type="number" min="0" max="2" bind:value={punch.startDay} disabled={!selected.writable || saving} /></label><label>Out (blank = open) <input type="time" bind:value={punch.end} disabled={!selected.writable || saving} /></label><label>Day offset <input type="number" min="0" max="2" bind:value={punch.endDay} disabled={!selected.writable || saving} /></label><button type="button" onclick={() => punches = punches.filter((_, i) => i !== index)} disabled={!selected.writable || saving}>Remove interval</button></Cluster>
     {/each}
     <button type="button" onclick={() => punches = [...punches, { start: '', startDay: 0, end: '', endDay: 0 }]} disabled={!selected.writable || saving}>Add interval</button>
     <p>{punches.length === 0 ? 'Reviewed: no work' : assessment?.problem ?? (assessment?.workedMinutes == null ? 'Open attendance' : `${assessment.workedMinutes} minutes; ${assessment.breakMinutes} minutes unpaid break`)}</p>
    {/if}
    {#if failure}<p role="alert">{failure}</p>{/if}
         <button type="button" onclick={saveDay} disabled={saving || !selected.writable || intent === 'none' || attendanceKnown && punches.length > 0 && assessment?.problem != null || attendanceDirty && selected.date > (result?.observed_day ?? '')}>{bolt.t(daySaveLabelKey('controller', intent === 'none' ? 'changes' : intent) as Parameters<typeof bolt.t>[0])}</button>
     <button type="button" onclick={() => selected = null}>Close</button>
   </Stack>
  {/if}
 </Stack>
 <Table of="roster_entries" where={scope.id == null ? { id: { in: [] } } : { employment_id: { is: { company_id: { eq: scope.id } } } }} columns={['employment_id', 'work_date', 'shift_definition_id', 'worked_intervals']} toolbar={{ actions: [{ run: importAttendance, icon: 'lucide:file-spreadsheet', group: 'import', label: bolt.t('holiday_import.spreadsheet'), disabled: () => importing || scope.id == null ? bolt.t('component.loading') : null }] }} />
</AppShell>
