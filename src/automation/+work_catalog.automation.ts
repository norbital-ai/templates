import { automation, type Id } from '@norbital-ai/bolt';
import { readAll, memoizedReads } from '../lib/payroll_engine/foundation/reads.js';
import { isCalendarDate } from '../lib/payroll_engine/foundation/time.js';
import { resolveNativeProfileSettlements } from '../lib/payroll_engine/catalogues/static.js';
import {captureNativePayrollSelection} from '../lib/payroll-selection-source.js';
import { refuse } from '../lib/payroll_engine/foundation/primitives.js';

/** One WORK catalog runner. Native statements derive configured figures and pin actual sources; held writes do not finalize a run. */
const work_catalog = automation({
 description: 'Calculate the approved saved run through WORK catalog payroll configuration as the original caller. Preserve paid outputs, replace unpaid outputs, and finalize only a complete approved population.',
 input: { run_id: { kind: 'id', of: 'payroll_runs' } },
 output: { kind: 'json' }, runAs: 'trigger', concurrency: { max: 1 }
});
export default work_catalog;

work_catalog.run(async (input, ctx) => {
 const reads = memoizedReads(ctx);
 const runs = await readAll<{ id: string; revision: number; company_id: string; period: string; kind: string; sequence: number; sources: string[]; attendance_from: string; attendance_to: string; salary_from:string; salary_to:string; approval_id: unknown }>(reads, 'payroll_runs', { id: { eq: input.run_id }, approval_id: { isNull: true } }, undefined, { id: true, revision: true, company_id: true, period: true, kind: true, sequence: true, sources: true, attendance_from: true, attendance_to: true, salary_from:true,salary_to:true,approval_id: true }, 1);
 const run = runs[0];
 if (runs.length !== 1 || run?.id !== String(input.run_id) || run.approval_id != null || !isCalendarDate(run.attendance_from) || !isCalendarDate(run.attendance_to) || run.attendance_from > run.attendance_to) refuse('WORK payroll requires its actual caller-readable approved run and dated window.');
 const [profiles, existing, siblings] = await Promise.all([
  readAll<{ id: Id<'employee_profiles'>; company_id: string; effective_range: { from: string; to: string | null }; approval_id: unknown }>(reads, 'employee_profiles', { company_id: { eq: run.company_id }, approval_id: { isNull: true } }, undefined, { id: true, company_id: true, effective_range: true, approval_id: true }),
  readAll<{ id: Id<'payslips'>; employment_id: string; status: string; approval_id: unknown }>(reads, 'payslips', { payroll_run_id: { eq: run.id } }, undefined, { id: true, employment_id: true, status: true, approval_id: true }),
  readAll<{ id: string; period: string; sequence: number }>(reads, 'payroll_runs', { company_id: { eq: run.company_id } }, undefined, { id: true, period: true, sequence: true })
 ]);
 if (siblings.some(other => other.period > run.period || (other.period === run.period && other.sequence > run.sequence))) refuse('An actual later payroll depends on this run; correct it in a later settlement.');
 if (existing.some(row => row.approval_id != null)) return { phase: 'AWAITING_APPROVAL', completed: false, run_id: run.id };
 const selected = run.kind === 'OFF_CYCLE' || run.kind === 'CORRECTION';
 const sourceRows = selected ? await readAll<{ id: string; employment_id: string; company_id: string; approval_id: unknown }>(reads, 'catalogue_entries', { id: { in: run.sources }, company_id: { eq: run.company_id }, approval_id: { isNull: true } }, undefined, { id: true, employment_id: true, company_id: true, approval_id: true }) : [];
 if (selected && (!run.sources.length || sourceRows.length !== run.sources.length || sourceRows.some(row => row.company_id !== run.company_id || row.approval_id != null))) refuse('Selected payroll requires every original approved entry and its actual owner.');
 const selectedProfiles = new Set(sourceRows.map(row => row.employment_id));
 const populationSource=await captureNativePayrollSelection(reads,{run_id:run.id,observation:{observedAt:String(ctx.now),timezone:'UTC'}});
 const candidates = profiles.filter(profile => {
  if(!populationSource.population.profile_ids.includes(profile.id))return false;
  if (selected && !selectedProfiles.has(profile.id)) return false;
  if (profile.company_id !== run.company_id || profile.approval_id != null || !isCalendarDate(profile.effective_range.from) || (profile.effective_range.to != null && (!isCalendarDate(profile.effective_range.to) || profile.effective_range.to < profile.effective_range.from))) refuse('WORK payroll requires actual approved dated owner profiles.');
  if (run.kind === 'FINAL' && (profile.effective_range.to == null || profile.effective_range.to < run.salary_from || profile.effective_range.to > run.salary_to)) return false;
  return selected||profile.effective_range.from <= run.salary_to && (profile.effective_range.to == null || profile.effective_range.to >= run.salary_from);
 });
 const settlements=await resolveNativeProfileSettlements(reads,{run_id:run.id,profile_ids:candidates.map(profile=>String(profile.id)),observation:{observedAt:String(ctx.now),timezone:'UTC'}});
 const population=populationSource.population.salary_payment===false?candidates:candidates.filter(profile=>settlements.some(settlement=>settlement.profile_id===profile.id&&settlement.runs===true));
 if (!population.length&&populationSource.population.profile_ids.length) refuse('WORK payroll has no actual configured payable population.');
 const ids = new Set<string>();
 for (const [index, profile] of population.entries()) {
  if (ids.has(profile.id)) refuse('WORK payroll cannot repeat an original profile.');
  ids.add(profile.id);
  const old = existing.filter(row => row.employment_id === profile.id);
  if (old.length > 1) refuse('WORK payroll cannot duplicate the same original profile settlement.');
  if (old[0]?.status === 'PAID') continue;
  const request = { run_id: run.id, profile_id: String(profile.id) };
  const outcome = old[0] == null
   ? await ctx.act('payslips.create', { source_basis: request }, { key: `${ctx.invocationId}:${profile.id}` })
    : await ctx.act('payslips.update', { target: old[0].id, set: { source_basis: request } }, { key: `${ctx.invocationId}:${profile.id}` });
  if (outcome.kind === 'pendingApproval') return { phase: 'AWAITING_APPROVAL', completed: false, run_id: run.id, profile_id: String(profile.id) };
  await ctx.progress({ ratio: (index + 1) / population.length, text: `Calculated ${index + 1} of ${population.length} payroll profiles.` });
 }
 // Finalization re-reads actual committed outputs rather than this runner's cached planning snapshot.
 const finalized = await ctx.act('payroll_runs.update', { target: input.run_id, set: { source_basis: { operation: 'FINALIZE', profile_ids: [...ids] } } }, { key: `${ctx.invocationId}:finalize` });
 return { phase: finalized.kind === 'committed' ? 'CALCULATED' : 'AWAITING_APPROVAL', completed: finalized.kind === 'committed', run_id: run.id };
});
