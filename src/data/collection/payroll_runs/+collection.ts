import {produceNativePayrollReports} from '../../../lib/payroll-report-source.js';
import {produceNativePayrollExport} from '../../../lib/payroll-export-source.js';
import {prepareNativePayrollDeletion} from '../../../lib/payroll_engine/payslips/payment.js';
import {executeQualifiedRuleSetStage} from '../../../lib/payroll_engine/execution/rule-sets.js';
import {qualifyNativePayrollOrchestration} from '../../../lib/payroll-run-stages.js';
import {prepareAtomicNativePayrollRun} from '../../../lib/payroll_engine/payslips/atomic.js';
import {captureNativePayrollSelection} from '../../../lib/payroll-selection-source.js';
import {captureNativePayrollCycleScope} from '../../../lib/payroll-cycle-source.js';
import {captureNativeFinalPayDiagnostics} from '../../../lib/final-pay-source.js';
import {policyAdmissionFault} from '../../../lib/payroll_engine/catalogues/admission.js';
import {nativeSourceAdmitted,preparedNativeSource} from '../../../lib/payroll_engine/admission/prospective-reads.js';
import runPeriodAdmission from '../../../../library/runtime-run-period-admission.json' with {type:'json'};
import {evaluateConfigured} from '../../../lib/payroll_engine/execution/expressions/core.js';
import { collection } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
import { Schema } from 'effect';
import { prepareConfiguredBehaviourExecution } from '../../../lib/payroll_engine/execution/behaviours.js';
import { resolveNativeProfileSettlements } from '../../../lib/payroll_engine/catalogues/static.js';
import { finalizeNativeStatutoryRun } from '../../../lib/payroll_engine/payslips/statutory.js';
import { readAll } from '../../../lib/payroll_engine/foundation/reads.js';
import { plain, stableJson } from '../../../lib/payroll_engine/foundation/primitives.js';
import { refuse } from '../../../lib/payroll_engine/foundation/primitives.js';
import { settingsInForce } from '../../../lib/payroll_engine/admission/schema-version.js';
import { calendarDateInTimeZone, isOffsetIsoInstant } from '../../../lib/payroll_engine/foundation/time.js';
import model from '../../model/payroll_runs/+model.ts';
import { isCalendarDate } from '../../../lib/payroll_engine/foundation/time.js';
import * as Predicate from 'effect/Predicate';

const capturedHash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJson(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
function retainedIdentities(value:unknown,path='$'):unknown[]{
 if(Array.isArray(value))return value.flatMap((item,index)=>retainedIdentities(item,`${path}[${index}]`));
 if(!Schema.is(Schema.Record(Schema.String,Schema.Unknown))(value))return [];
 const row=value,identity=Object.fromEntries(Object.entries(row).filter(([key,item])=>['id','revision','settings_id','configuration_hash','schema_hash','program_ref','value_hash','definition_id','definition_hash'].includes(key)&&(Predicate.isString(item)||Predicate.isNumber(item))));
 return [...(Object.keys(identity).length?[{path,...identity}]:[]),...Object.entries(row).flatMap(([key,item])=>retainedIdentities(item,`${path}.${key}`))];
}

const c = collection('payroll_runs', {
 read: { fields: 'all' },
 create: { input: { columns: ['company_id', 'period', 'kind', 'sources', 'pay_due_date'] } },
 update: { input: { columns: ['source_basis'] } },
 delete:{transform:true},
 actions: {
  report_data:{target:"record",description:"Read the configured original saved payroll report, retaining actual closing sources.",input:{},output:{kind:"json"}},
  export_file:{target:"record",description:"Render an original declared filing from actual saved payroll sources.",input:{code:{kind:"text"}},output:{kind:"json"}},
  delete_saved:{target:'record',description:'Delete an unpaid saved payroll and release its actual sources atomically.',input:{},output:{kind:'json'}},
  calculate: {
   target: 'record',
   description: 'Calculate the actual saved run population through immutable configured payroll operations. Every payslip derives its figures from qualified sources.',
   input: {}, output: { kind: 'json' }
  }
 }
});
export default c;

c.action('report_data',async(_input,ctx)=>Schema.decodeUnknownSync(Schema.Json)(await produceNativePayrollReports(ctx,{run_ids:[ctx.target.id],observation:{observedAt:String(ctx.now),timezone:ctx.tz}})));

c.action('export_file',async(input,ctx)=>Schema.decodeUnknownSync(Schema.Json)(await produceNativePayrollExport(ctx,{run_id:ctx.target.id,code:input.code,observation:{observedAt:String(ctx.now),timezone:ctx.tz}})));

c.action('delete_saved',async(_input,ctx)=>{await ctx.act('entities.update',{target:ctx.target.company_id,set:{source_basis:{operation:'DELETE_PAYROLL',run_ids:[ctx.target.id],slip_ids:[]}}});return {deleted:true,run_id:ctx.target.id};});

c.action('calculate', async (_input, ctx) => {
 const run = plain(ctx.target);
 if (run.approval_id != null || !isCalendarDate(run.attendance_from) || !isCalendarDate(run.attendance_to) || run.attendance_from > run.attendance_to) refuse('Payroll requires its actual approved saved attendance window.');
 const scheduled = await ctx.schedule('work_catalog', { run_id: ctx.target.id }, { key: `${run.id}:${run.revision}:${ctx.invocationId}` });
 return Schema.decodeUnknownSync(Schema.Json)({ phase: 'SCHEDULED', completed: false, scheduled });
});

/** The submitted run contains routing choices only. Calendar, output captures and provenance are configuration-derived. */
export const prepareNativePayrollRunWrites:Parameters<typeof c.transform>[0]=async (inputs, ctx) => {
 if(inputs.some(input=>'$delete' in input)){
  if(!inputs.every(input=>'$delete' in input)||ctx.existing.some(row=>row==null))refuse('Deletion cannot mix saved payroll releases and financial mutations.');
  const captured=await prepareNativePayrollDeletion(ctx.db,{run_ids:ctx.existing.map(row=>String(plain(row!).id)),slip_ids:[],observation:{observedAt:String(ctx.now),timezone:ctx.tz}});
  if(captured.partitions.some(partition=>Array.isArray(partition.remove_ids)&&partition.remove_ids.length))refuse('Use delete_saved to release the actual unpaid financial ledger and source pins atomically.');
  return inputs;
 }
 const writes=inputs.map(input=>'$delete' in input?undefined:input).filter((input): input is NonNullable<typeof input>=>input!==undefined);

 if (ctx.existing.some(row => row != null)) {
  if (writes.length !== 1 || ctx.existing[0] == null) refuse('Finalize one actual saved payroll at a time.');
  const run = plain(ctx.existing[0]);
  const request = Schema.decodeUnknownSync(Schema.Struct({ operation: Schema.Literal('FINALIZE'), profile_ids: Schema.Array(Schema.NonEmptyString) }))(writes[0]!.source_basis, { onExcessProperty: 'error' });
  if (!nativeSourceAdmitted(ctx.db,'payroll_runs',run) || new Set(request.profile_ids).size !== request.profile_ids.length) refuse('Finalization requires an approved run and its unique actual population.');
  const salaryFrom=run.salary_from,salaryTo=run.salary_to;
  if(!Predicate.isString(salaryFrom)||!Predicate.isString(salaryTo))refuse('Finalization requires its actual salary window.');
  const selectedVersions=await readAll<{id:string;behaviours:unknown;payroll:{timezone:string}}>(ctx.db,'jurisdiction_settings',{id:{eq:run.settings_id},approval_id:{isNull:true},voided_at:{isNull:true}},undefined,{id:true,behaviours:true,payroll:true},1);
  if(selectedVersions.length!==1)refuse('Finalization retains its actual governing source registry.');
  const orchestration=await qualifyNativePayrollOrchestration(ctx.db,selectedVersions[0]!.behaviours,run);
  const populationSource=await captureNativePayrollSelection(ctx.db,{run_id:String(run.id),observation:{observedAt:String(ctx.now),timezone:selectedVersions[0]!.payroll.timezone}});
  const profiles = await readAll<{ id: string; effective_range: { from: string; to: string | null } }>(ctx.db, 'employee_profiles', { company_id: { eq: run.company_id }, approval_id: { isNull: true } }, undefined, { id: true, effective_range: true });
  const selected = run.kind === 'OFF_CYCLE' || run.kind === 'CORRECTION';
  const selectedEntries = selected ? await readAll<{ id: string; employment_id: string }>(ctx.db, 'catalogue_entries', { id: { in: run.sources }, company_id: { eq: run.company_id }, approval_id: { isNull: true } }, undefined, { id: true, employment_id: true }) : [];
  if (selected && (run.sources == null || !Array.isArray(run.sources) || selectedEntries.length !== run.sources.length)) refuse('Finalization retains all original selected approved source owners.');
  const candidates = profiles.filter(profile => populationSource.population.profile_ids.includes(profile.id)&&(!selected || selectedEntries.some(entry => entry.employment_id === profile.id)) && (selected||profile.effective_range.from <= salaryTo && (profile.effective_range.to == null || profile.effective_range.to >= salaryFrom)) && (run.kind !== 'FINAL' || profile.effective_range.to != null && profile.effective_range.to >= salaryFrom && profile.effective_range.to <= salaryTo)).map(profile => profile.id);
  if(orchestration!=null&&(candidates.length!==orchestration.population.profile_ids.length||orchestration.population.profile_ids.some(id=>!candidates.includes(id))))refuse('Finalization retains every actual configured stage population owner.');
  const settlements=await resolveNativeProfileSettlements(ctx.db,{run_id:String(run.id),profile_ids:candidates,observation:{observedAt:String(ctx.now),timezone:'UTC'}});
  const expected=populationSource.population.salary_payment===false?candidates:candidates.filter(id=>settlements.some(settlement=>settlement.profile_id===id&&settlement.runs===true));
  if (expected.length !== request.profile_ids.length || expected.some(id => !request.profile_ids.includes(id))) refuse('Finalization cannot declare a partial original payroll population complete.');
  const slips = await readAll<{ id: string; revision:number; employment_id: string; approval_id: unknown; source_basis: unknown }>(ctx.db, 'payslips', { payroll_run_id: { eq: run.id } }, undefined, { id: true, revision:true,employment_id: true, approval_id: true, source_basis: true });
  if (slips.length !== request.profile_ids.length || slips.some(row => row.approval_id != null || !request.profile_ids.includes(row.employment_id)) || new Set(slips.map(row => row.employment_id)).size !== slips.length) refuse('Finalization requires every actual approved profile settlement exactly once.');
  for (const slip of slips) {
   const basis = slip.source_basis;
   if (!Schema.is(Schema.Record(Schema.String,Schema.Json))(basis) || !('native_stages' in basis)) refuse('Finalization requires actual captured original payroll policy stages for every settlement.');
   const stages = basis.native_stages;
   if (!Schema.is(Schema.Record(Schema.String,Schema.Json))(stages)) refuse('Finalization requires intact original payroll stage captures.');
   const stage = stages;
   if (!Array.isArray(stage.issues) || !Array.isArray(stage.captures)) refuse('Finalization cannot treat absent original stage decisions as a clean settlement.');
   const decision=Schema.Struct({severity:Schema.Literals(['WARNING','BLOCKER']),code:Schema.NonEmptyString,message:Schema.String});
   if (stage.issues.some(issue => !Schema.is(decision)(issue))) refuse('Finalization requires valid original payroll policy decisions.');
   if (stage.issues.some(issue => !Schema.is(decision)(issue) || issue.severity === 'BLOCKER')) refuse('Original payroll policy blockers must be resolved before finalization.');
   for (const capture of stage.captures) {
    if (!Predicate.isObject(capture) || !Array.isArray(capture.issues) || !Array.isArray(capture.captures)) refuse('Finalization requires intact captured original stage executions.');
    if (capture.issues.some((issue: unknown) => !Schema.is(Schema.Struct({severity:Schema.Literal('WARNING')}))(issue))) refuse('Finalization cannot hide a blocker inside a captured original stage execution.');
   }
  }
  const versions = await readAll<{ id: string; payroll: { timezone: string } }>(ctx.db, 'jurisdiction_settings', { id: { eq: run.settings_id }, approval_id: { isNull: true } }, undefined, { id: true, payroll: true }, 1);
  const version = versions[0];
  if (versions.length !== 1 || !Schema.is(Schema.NonEmptyString)(version?.payroll?.timezone)) refuse('Finalization requires its original payroll timezone.');
  const observation = { observedAt: String(ctx.now), timezone: version!.payroll.timezone };
  const assessment = await finalizeNativeStatutoryRun(ctx.db, { run_id: String(run.id), observation });
  const data = Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))({ payslips: slips, assessment });
  const prepared = await prepareConfiguredBehaviourExecution(ctx.db, { event: { id: `${run.id}:finalize`, kind: 'PAYROLL_FINALIZE', subject: { collection: 'entities', id: String(run.company_id) }, data }, catalog: 'WORK', snapshot_id: String(run.settings_id), configuration_hash: String(run.configuration_hash), day: String(run.salary_to), run_id: String(run.id), observation }, { FINALIZE_RUN: 'payroll_runs' });
  const operations = prepared.execution.plan.filter(row => row.operation.capability === 'FINALIZE_RUN');
  if (operations.length !== 1) refuse('Finalization requires exactly one complete configured employer assessment operation.');
  const fields = operations[0]!.args;
  const allowed = ['company_charges', 'company_remittances', 'calculation_trace', 'warnings', 'calculation_version', 'original_final_source'];
  if (Object.keys(fields).some(key => !allowed.includes(key)) || allowed.some(key => !(key in fields))) refuse('Finalization retains all native routing and requires complete financial captures.');
  const remittanceFault=policyAdmissionFault('company_remittances',fields.company_remittances);if(remittanceFault!=null)refuse(remittanceFault);
  const exitingProfiles=populationSource.population.salary_payment?profiles.filter(profile=>request.profile_ids.includes(profile.id)&&profile.effective_range.to!=null&&profile.effective_range.to>=salaryFrom&&profile.effective_range.to<=salaryTo).map(profile=>profile.id):[];
  const finalPayDiagnostics=await captureNativeFinalPayDiagnostics(ctx.db,{run_id:String(run.id),profile_ids:exitingProfiles,observation});
  if(!Predicate.isString(fields.warnings))refuse('Finalization retains its actual configured diagnostic text.');
  const warnings=[fields.warnings,...finalPayDiagnostics.issues.map(issue=>String(issue.message))].filter(message=>message!=='').join('\n');
  const settlementsManifest=[];
  for(const slip of [...slips].sort((a,b)=>a.id.localeCompare(b.id))){
   const basis=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(slip.source_basis);
   if(basis.execution==null||!Predicate.isString(basis.hash)||await capturedHash(basis.execution)!==basis.hash)refuse('A calculation manifest requires the exact retained native settlement execution and its original hash.');
   const phase=preparedNativeSource(ctx.db,'payslips',slip.id);
   settlementsManifest.push({id:slip.id,...(phase===undefined?{revision:slip.revision}:{native_phase:phase}),profile_id:slip.employment_id,execution_hash:basis.hash,retained_sources:retainedIdentities(basis.execution)});
  }
  const calculation_manifest={format:'CONFIGURED_SOURCE_MANIFEST_V1',run_id:run.id,settings_id:run.settings_id,configuration_hash:run.configuration_hash,settlements:settlementsManifest,finalization:{execution_hash:prepared.hash,retained_sources:retainedIdentities(prepared.execution)},assessment_hash:await capturedHash(assessment),final_pay_diagnostics_hash:await capturedHash(finalPayDiagnostics)};
  const calculation_version=`configured:${await capturedHash(calculation_manifest)}`;
  return [{ ...fields,warnings,calculation_version,calculation_manifest, calculation_state: 'CALCULATED', source_basis: { calendar: Predicate.isObject(run.source_basis) && 'calendar' in run.source_basis ? run.source_basis.calendar : run.source_basis, finalization: { request, key: prepared.key, hash: prepared.hash, execution: prepared.execution, population: assessment.population,population_source:populationSource,final_pay_diagnostics:finalPayDiagnostics,calculation_version } } }] as never;
 }
 const companies = [...new Set(writes.map(input => String(input.company_id)))];
 if (companies.length !== writes.length) refuse('Create one payroll per company at a time so every run observes its actual prior settlement.');
 const [entities, prior] = await Promise.all([
  readAll<{ id: string; name: string; settings_code: string; approval_id: unknown;[key:string]:unknown }>(ctx.db, 'entities', { id: { in: companies }, approval_id: { isNull: true } }),
  readAll<{ id: string; company_id: string; period: string; kind: string; sequence: number; approval_id: unknown }>(ctx.db, 'payroll_runs', { company_id: { in: companies } }, undefined, { id: true, company_id: true, period: true, kind: true, sequence: true, approval_id: true })
 ]);
 const versions = await readAll<{ id: string; code: string; effective_range: { from: string; to: string | null }; sealed_at: string; voided_at: unknown; approval_id: unknown; behaviours: unknown; payroll: { timezone: string } }>(ctx.db, 'jurisdiction_settings', { code: { in: [...new Set(entities.map(entity => entity.settings_code))] }, sealed_at: { isNull: false, lte: String(ctx.now) }, voided_at: { isNull: true }, approval_id: { isNull: true } }, undefined, { id: true, code: true, effective_range: true, sealed_at: true, voided_at: true, approval_id: true, behaviours: true, payroll: true });
 const results = [];
 for (let inputIndex=0;inputIndex<writes.length;inputIndex++) {
  const input=writes[inputIndex]!;
  const entity = entities.find(row => row.id === String(input.company_id));
  if (entity == null || entity.approval_id != null) refuse('Payroll requires its actual approved entity.');
  const cycleTimezone=versions.find(row=>row.code===entity.settings_code&&Schema.is(Schema.NonEmptyString)(row.payroll?.timezone))?.payroll.timezone;
  const cycleScope=input.period==null||input.period===''?await captureNativePayrollCycleScope(ctx.db,{company_id:entity.id,observation:{observedAt:String(ctx.now),timezone:cycleTimezone??ctx.tz}}):null;
  const period = input.period || (cycleScope?.scope as Record<string,unknown>|undefined)?.next;
  if(!Predicate.isString(period))refuse('Payroll requires its actual configured selected cycle period.');
  if (!/^\d{4}-(0[1-9]|1[0-2])(-[1-5])?$/.test(period)) refuse('Payroll requires the actual contracted month or instalment period.');
  const closing = new Date(period.slice(0, 7) + '-01T00:00:00Z');
  closing.setUTCMonth(closing.getUTCMonth() + 1, 0);
  const closedDay = closing.toISOString().slice(0, 10);
  const timezoneVersion = versions.find(row => row.code === entity.settings_code && Schema.is(Schema.NonEmptyString)(row.payroll?.timezone));
  const missingVersion=(liabilityDay:string)=>`${entity.name || entity.id} operates under jurisdiction settings ${entity.settings_code}, which has no sealed version covering ${liabilityDay}. ${period} payroll cannot be priced. Seal a ${entity.settings_code} version covering the payroll liability date before creating this run.`;
  if (timezoneVersion == null) refuse(missingVersion(closedDay));
  const observedDay = calendarDateInTimeZone(new Date(String(ctx.now)), timezoneVersion.payroll.timezone);
  let day = closedDay > observedDay ? observedDay : closedDay;
  let version = settingsInForce(versions, entity.settings_code, day);
  if (version == null) refuse(missingVersion(day));
  if (!isOffsetIsoInstant(version.sealed_at) || !Schema.is(Schema.NonEmptyString)(version.payroll?.timezone)) refuse('Payroll requires its actual sealed governing calendar configuration.');
  const kind = input.kind ?? 'REGULAR';
  if (kind === 'EARLY') refuse('An EARLY settlement must be derived atomically by its configured off-cycle source.');
  const sources = [...new Set(input.sources ?? [])];
  if ((kind === 'REGULAR' || kind === 'FINAL') && sources.length) refuse('A population payroll cannot substitute selected request identities.');
  const siblings = prior.filter(row => row.company_id === entity.id);
  if (siblings.some(row => row.approval_id != null)) refuse('Payroll cannot reinterpret a pending prior settlement.');
  const previous=evaluateConfigured(runPeriodAdmission.previous_expression,{period});
  if(!Predicate.isString(previous))refuse('Stored run admission requires its actual preceding period.');
  const periodFault=evaluateConfigured(runPeriodAdmission.fault_expression,{period,kind,runs:siblings,previous});
  if(!Predicate.isString(periodFault))refuse('Stored run admission requires its original refusal or empty success result.');
  if(periodFault!=='')refuse(periodFault);
  const period_admission={version:1,contract:runPeriodAdmission,contract_hash:await capturedHash(runPeriodAdmission),observed_at:String(ctx.now),writes:{period,kind,runs:siblings},previous,result:periodFault};
  if (siblings.some(row => !Number.isSafeInteger(row.sequence) || row.sequence < 1)) refuse('Payroll requires actual valid prior settlement sequence captures.');
  const sequence = Math.max(0, ...siblings.filter(row => row.period === period).map(row => row.sequence)) + 1;
  if (!Number.isSafeInteger(sequence)) refuse('Payroll sequence cannot lose original integer precision.');
  let configuration_hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(version.behaviours)))), byte => byte.toString(16).padStart(2, '0')).join('');
  const request = Schema.decodeUnknownSync(Schema.Json)({ company_id: entity.id, period, kind, sources, sequence, ...(input.pay_due_date == null ? {} : { pay_due_date: String(input.pay_due_date) }) });
  let prepared = await prepareConfiguredBehaviourExecution(ctx.db, {
   event: { id: `${entity.id}:${period}:${sequence}`, kind: 'PAYROLL_CREATE', subject: { collection: 'entities', id: entity.id }, data: { request } },
   catalog: 'WORK', snapshot_id: version.id, configuration_hash, day,
   observation: { observedAt: String(ctx.now), timezone: version.payroll.timezone }
  }, { CREATE_RUN: 'payroll_runs' });
  if (prepared.execution.plan.length !== 1) refuse('Payroll requires exactly one complete configured calendar and source capture operation.');
  let step = prepared.execution.plan[0]!;
  const text=(value:unknown)=>Schema.decodeUnknownSync(Schema.String)(value);
  let payDate=text(step.args.pay_date);
  if (!isCalendarDate(payDate) || payDate > observedDay) refuse('Payroll requires its actual observable configured settlement date.');
  const governing = settingsInForce(versions, entity.settings_code, payDate);
  if (governing == null) refuse('Payroll requires its actual configured settlement-date jurisdiction snapshot.');
  if (governing.id !== version.id || day !== payDate) {
   version = governing; day = payDate;
   configuration_hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(version.behaviours)))), byte => byte.toString(16).padStart(2, '0')).join('');
   prepared = await prepareConfiguredBehaviourExecution(ctx.db, { event: { id: `${entity.id}:${period}:${sequence}`, kind: 'PAYROLL_CREATE', subject: { collection: 'entities', id: entity.id }, data: { request } }, catalog: 'WORK', snapshot_id: version.id, configuration_hash, day, observation: { observedAt: String(ctx.now), timezone: version.payroll.timezone } }, { CREATE_RUN: 'payroll_runs' });
   if (prepared.execution.plan.length !== 1) refuse('Payroll requires its original complete settlement-date calendar operation.');
   step = prepared.execution.plan[0]!;
   payDate=text(step.args.pay_date);
  }
  const allowed = new Set([...Object.keys(model.fields), 'company_id', 'settings_id']);
  if (step.operation.capability !== 'CREATE_RUN' || Object.keys(step.args).some(key => !allowed.has(key) || ['source_basis', 'calculation_state', 'sequence', 'configuration_hash', 'company_id', 'settings_id'].includes(key))) refuse('Configured payroll cannot replace native sequence, ownership or provenance.');
  const fields = { ...step.args };
  const holidayFault=policyAdmissionFault('holiday_snapshots',fields.holidays);if(holidayFault!=null)refuse(holidayFault);
  if (fields.period !== period || fields.kind !== kind || stableJson(fields.sources) !== stableJson(sources) || fields.pay_date !== payDate || !isCalendarDate(text(fields.pay_date)) || !isCalendarDate(text(fields.attendance_from)) || !isCalendarDate(text(fields.attendance_to)) || text(fields.attendance_from) > text(fields.attendance_to)) refuse('Configured payroll must retain its selected period, kind and exact calendar window.');
  if (fields.pay_date < version.effective_range.from || (version.effective_range.to != null && fields.pay_date > version.effective_range.to)) refuse('Payroll calendar selects a different governing jurisdiction; retain its actual pay-date snapshot.');
  const openRunDuties=await readAll<Record<string,unknown>>(ctx.db,'obligations',{company_id:{eq:entity.id},subject_kind:{eq:'RUN'},state:{eq:'OPEN'},approval_id:{isNull:true}});
  const runDuties=await executeQualifiedRuleSetStage(ctx.db,{settings_id:version.id,observation:{observedAt:String(ctx.now),timezone:version.payroll.timezone},families:['OBLIGATIONS'],stage:'RUN',context:{check:{at:'RUN',date:day},obligations:{open:[...new Set(openRunDuties.map(row=>String(row.duty_code)))]}},subject:String(entity.name??entity.id),collection:'payroll_runs'});
  const dutyBlockers=runDuties.issues.filter(issue=>issue.severity==='BLOCKER');
  if(dutyBlockers.length)refuse(dutyBlockers.map(issue=>issue.message).join(' '));
  for (const key of ['pay_date', 'pay_due_date', 'salary_from', 'salary_to', 'attendance_from', 'attendance_to'] as const) if (fields[key] != null) fields[key] = PlainDate(Schema.decodeUnknownSync(Schema.String)(fields[key])) as never;
  const calendar={ request, key: prepared.key, hash: prepared.hash, execution: prepared.execution, period_admission,...(cycleScope==null?{}:{cycle_scope:cycleScope}),run_duties:{sources:openRunDuties,rule_sets:runDuties.rule_sets,eligibility:runDuties.eligibility,captures:runDuties.captures,issues:runDuties.issues} };
  if(kind==='OFF_CYCLE')results.push(await prepareAtomicNativePayrollRun(ctx,{input_index:inputIndex,fields:{...fields,configuration_hash},request:Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(request),entity,version:{...version},versions:versions.map(item=>({...item})),sequence,calendar,finalize:prepareNativePayrollRunWrites}));
  else results.push({ ...fields, company_id: input.company_id, settings_id: version.id, sequence, configuration_hash, calculation_state: 'PENDING', source_basis: calendar });
 }
 return results as never;
};
c.transform(prepareNativePayrollRunWrites);
