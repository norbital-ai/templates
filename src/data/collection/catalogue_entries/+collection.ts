import {captureNativeLoanPlan} from '../../../lib/loan-plan-source.js';
import {admitNativeScheduledEffect} from '../../../lib/configured-scheduled-occurrences.js';
import { projectCatalogOriginal } from '../../../lib/payroll_engine/admission/input-access.js';
import { captureNativeConfiguredStage } from '../../../lib/payroll_engine/execution/configured-execution.js';
import { captureNativeLeaveBalanceReport, captureNativeLeaveFunding, refuseNativeTransferredPredecessorUsage, captureNativeLeaveActivity, captureNativeLeaveExitDraft, captureNativeLeaveSummary, captureNativeLeavePreview, admitConfiguredEntryRequest, type NativeLeaveDraft } from '../../../lib/payroll_engine/catalogues/entries.js';
import { admitRuntimeProofs, runtimeProofReads, inputProofCapture } from '../../../lib/payroll_engine/admission/runtime-proof.js';
import { isOffsetIsoInstant, calendarDateInTimeZone, calendarDay } from '../../../lib/payroll_engine/foundation/time.js';
import { Schema } from 'effect';
import { PlainDate } from '@norbital-ai/std/date';
import { stageConfiguredBehaviourExecution, admitConfiguredCatalogEffect, prepareNativeCatalogSourceEvent, type CatalogEffectSource } from '../../../lib/payroll_engine/execution/behaviours.js';
import { collection, type FileRef, type Id, type Insert, type Patch } from '@norbital-ai/bolt';
import { readAll, memoizedReads } from '../../../lib/payroll_engine/foundation/reads.js';
import { plain, stableJson } from '../../../lib/payroll_engine/foundation/primitives.js';
import { refuse } from '../../../lib/payroll_engine/foundation/primitives.js';
import { ENTRY_CATALOGS, entryDateCovered, entrySchemaSnapshot, admitEntryValues, type EntryCatalog, type EntrySchemaSnapshot } from '../../../lib/payroll_engine/admission/input-schema-admission.js';
import type { InputSchema } from '../../../lib/payroll_engine/datatypes/input-schema.js';
import * as Predicate from 'effect/Predicate';

const c = collection('catalogue_entries', {
 read: { fields: 'all', projection:{fields:['original_capture','migration_failure'],context:['original_capture','migration_failure','source_kind','catalog','catalogue_id','schema_snapshot']} },
 create: { input: { columns: ['source_basis', 'company_id', 'employment_id', 'catalog', 'catalogue_id', 'reference', 'occurred_on', 'values', 'input_proofs', 'input_files'] } },
 delete: { transform: true },
 update: { input: { columns: ['source_basis', 'reference', 'occurred_on', 'values', 'input_proofs', 'input_files'] } },
 queries: {
  loan_plan:{description:"Preview the actual configured loan schedule, captured installments and paid recovery without rewriting financial records.",input:{loan_id:{kind:"id",of:"catalogue_entries"}},output:{kind:"json"}},
  leave_balance_report:{description:"Read approved owned profile balances with original five-person pagination and refusal details.",input:{company_id:{kind:"id",of:"entities"},as_of:{kind:"date"},after:{kind:"id",of:"employee_profiles",optional:true}},output:{kind:"json"}},
  leave_summary: { description:'Read the original posted balance, future reserved availability, pending and expired credits from native catalog configuration.',input:{profile_id:{kind:'id',of:'employee_profiles'},catalogue_id:{kind:'id',of:'leave_catalogue'},as_of:{kind:'date'}},output:{kind:'json'} },
  preview_leave: { description:'Preview the actual calendar, half-day occupation and configured funding of an unpersisted leave selection.',input:{profile_id:{kind:'id',of:'employee_profiles'},catalogue_id:{kind:'id',of:'leave_catalogue'},calendar_month:{kind:'text',optional:true},range:{kind:'object',optional:true,fields:{start:{kind:'object',fields:{date:{kind:'date'},half:{kind:'enum',values:['FIRST','SECOND']}}},end:{kind:'object',fields:{date:{kind:'date'},half:{kind:'enum',values:['FIRST','SECOND']}}}}},exclude_entry_id:{kind:'id',of:'catalogue_entries',optional:true},hours:{kind:'number',optional:true},facts:{kind:'json',optional:true},preceding_leave_id:{kind:'id',of:'catalogue_entries',optional:true},no_pay_origin:{kind:'enum',values:['EMPLOYEE_REQUESTED','OTHER'],optional:true}},output:{kind:'json'} }
 },
 actions: {
  execute_event: {
   description: 'Stage catalog operations from the actual approved owner and immutable configured event rules through native entry admission.',
   input: {
    source_collection: { kind: 'enum', values: ['catalogue_entries', 'employee_profiles', 'payroll_runs', 'entities'], optional: true },
    source_id: { kind: 'text', optional: true },
    source_family: { kind: 'text', optional: true },
    source_record_id: { kind: 'text', optional: true },
    source_revision: { kind: 'int', min: 1, optional: true },
    source_entry_id: { kind: 'id', of: 'catalogue_entries', optional: true },
    catalog: { kind: 'enum', values: ['LEAVE', 'CLAIM', 'ADHOC', 'LOAN', 'CONTRIBUTION'] },
    profile_id: { kind: 'id', of: 'employee_profiles', optional: true },
    entity_id: { kind: 'id', of: 'entities', optional: true },
    snapshot_id: { kind: 'id', of: 'jurisdiction_settings' },
    configuration_hash: { kind: 'text' },
    original_event_hash: { kind: 'text', optional: true },
    event_kind: { kind: 'text' },
    day: { kind: 'date' }
   },
   output: { kind: 'json' }
  }
 }
});
export default c;
type SourceRow = { readonly id: string; readonly approval_id?: unknown; readonly settings_id?: string; readonly entry_schema?: InputSchema; readonly settings_code?: string; readonly pricing?: unknown; readonly company_id?: string; readonly effective_range?: unknown };
c.transform(async (inputs, ctx) => {
 const receiptReads = memoizedReads(ctx.db);
 if (inputs.some(value => '$delete' in value)) {
  if (!inputs.every(value => '$delete' in value)) refuse('Delete requests cannot mix with catalog mutations.');
  for (const value of ctx.existing) {
   const row = value == null ? undefined : plain(value);
   if (row == null || row.migration_failure != null || row.payslip_id != null || row.approval_id != null || row.source_kind !== 'loan_repayments') refuse('Only actual approved unpaid loan installments can be released.');
  }
  return inputs;
 }
 const writes=inputs.map(input=>'$delete' in input?undefined:input).filter((input): input is NonNullable<typeof input>=>input!==undefined);
 const batch = writes.map((value, index) => {
  const input = plain(value);
  const prior = ctx.existing[index] == null ? undefined : plain(ctx.existing[index]);
  if(Object.hasOwn(input,'migration_failure'))refuse('Original migration failure evidence is protected; native requests cannot supply, replace or clear it.');
  if(prior?.migration_failure!=null)refuse('This original candidate was not admitted by migration; preserve its exact failure evidence instead of producing native financial effects.');
  if (prior?.catalog === 'LEAVE') refuse('Approved Leave activity is immutable; create a linked reversal instead.');
  if (prior?.effect_key != null && input.source_basis == null) refuse('A configured operation receipt and its original target are immutable.');
  if (prior?.payslip_id != null) refuse('A payroll-captured catalog entry is immutable.');
  if (prior != null && !Schema.is(entrySchemaSnapshot)(prior.schema_snapshot)) refuse('An existing entry requires its original accepted schema capture.');
  if (prior != null) for (const field of ['company_id', 'employment_id', 'catalog', 'catalogue_id'] as const) {
   if (Object.hasOwn(input, field) && input[field] !== prior[field]) refuse('Retain the original entity, profile and catalog identity of this entry.');
  }
  const row = { ...prior, ...input };
  if (!Object.hasOwn(ENTRY_CATALOGS, String(row.catalog))) refuse('This catalog family does not create entries.');
  if (!Schema.is(Schema.NonEmptyString)(row.catalogue_id) || !row.catalogue_id.trim() || !Schema.is(Schema.NonEmptyString)(row.company_id) || !row.company_id.trim()) refuse('An entry requires its actual catalog and entity identities.');
  return { input, prior, row, catalog: row.catalog as EntryCatalog };
 });
 if (batch.length === 0) return [];

 const observedAt = String(ctx.now);
 if (!isOffsetIsoInstant(observedAt)) refuse('Catalog entry admission requires its actual native execution observation.');
 const requests = [
  ...Object.entries(ENTRY_CATALOGS).map(([family, collection]) => ({ collection, ids: [...new Set(batch.filter(item => item.catalog === family).map(item => item.row.catalogue_id!))] })),
  { collection: 'entities' as const, ids: [...new Set(batch.map(item => item.row.company_id!))] },
  { collection: 'employee_profiles' as const, ids: [...new Set(batch.flatMap(item => item.row.employment_id == null ? [] : [item.row.employment_id]))] }
 ];
 // First wave: independent catalogs and native owners. Empty scopes issue no reads.
 const answers = await Promise.allSettled(requests.map(request => readAll<SourceRow>(ctx.db, request.collection, { id: { in: request.ids }, approval_id: { isNull: true } })));
 const failures = answers.filter(answer => answer.status === 'rejected');
 if (failures.length) throw failures[0]!.reason;
 const sources = new Map<string, Map<string, SourceRow>>();
 for (let index = 0; index < answers.length; index++) {
  const answer = answers[index]!;
  if (answer.status !== 'fulfilled') continue;
  const request = requests[index]!, rows = new Map<string, SourceRow>();
  for (const row of answer.value) {
   if (!request.ids.some(id => id === row.id) || row.approval_id != null || rows.has(row.id)) refuse('Catalog entry sources require unique actual approved identities.');
   rows.set(row.id, row);
  }
  sources.set(request.collection, rows);
 }
 const definitions = batch.map(item => {
  const definition = sources.get(ENTRY_CATALOGS[item.catalog])?.get(item.row.catalogue_id!);
  if (definition == null || !Schema.is(Schema.NonEmptyString)(definition.settings_id) || !definition.settings_id.trim() || definition.entry_schema == null) refuse('An entry requires its actual approved catalog definition.');
  return definition;
 });
 // Second wave: only governing snapshots identified by the original catalog records.
 const snapshots = await readAll<{ readonly id: string; readonly code: string; readonly sealed_at: string | null; readonly effective_range: unknown; readonly payroll?: { readonly timezone?: string }; readonly voided_at?: unknown; readonly approval_id?: unknown }>(ctx.db, 'jurisdiction_settings', { id: { in: [...new Set(definitions.map(definition => definition.settings_id!))] }, approval_id: { isNull: true } });
 const versions = new Map<string, typeof snapshots[number]>();
 for (const snapshot of snapshots) {
  if (!definitions.some(definition => definition.settings_id === snapshot.id) || snapshot.approval_id != null || !isOffsetIsoInstant(snapshot.sealed_at) || Date.parse(snapshot.sealed_at) > Date.parse(observedAt) || !Schema.is(Schema.NonEmptyString)(snapshot.code) || !snapshot.code.trim() || versions.has(snapshot.id)) refuse('An entry requires its actual approved sealed governing snapshot.');
  versions.set(snapshot.id, snapshot);
 }
 const proofReads = await runtimeProofReads(ctx.db, batch.map(item => ({ collection: 'catalogue_entries' as const, files: item.row.input_files ?? [] })));
 const result = [];
 const stagedLeave: NativeLeaveDraft[] = [];
 const stagedRequests: Readonly<Record<string,unknown>>[] = [];
 for (let index = 0; index < batch.length; index++) {
  const { input, prior, row, catalog } = batch[index]!, definition = definitions[index]!;
  const { source_basis, ...receiptArgs } = structuredClone(input);
  let admissionCapture: unknown;
  let nativeStageCapture: unknown;
  const occurredOn = Schema.decodeUnknownSync(calendarDay)(row.occurred_on);
  const snapshot = versions.get(definition.settings_id!);
  if (snapshot == null) refuse('An entry requires its actual approved sealed governing snapshot.');
  let sourceDay = occurredOn;
  let manualActivityCapture: unknown;
  if (catalog === 'LEAVE' && prior == null && (source_basis == null || (Predicate.isObject(source_basis)&&source_basis.operation==='SCHEDULED_OCCURRENCE'))) {
   const request = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(row.values);
   if (request.activity !== 'TIME_OFF') {
    if (row.employment_id == null) refuse('A manual leave activity requires its actual employee profile.');
    const admitted = await captureNativeLeaveActivity(receiptReads, {profile_id:row.employment_id,catalogue_id:definition.id,request,occurred_on:occurredOn,reference:String(row.reference),observation:{observedAt,timezone:Schema.decodeUnknownSync(Schema.NonEmptyString)(snapshot.payroll?.timezone)},staged_entries:stagedLeave,input_files:Schema.decodeUnknownSync(Schema.Array(Schema.Struct({id:Schema.String})))(row.input_files??[])});
    sourceDay = Schema.decodeUnknownSync(calendarDay)(admitted.source_day);
    Object.assign(row,{values:Schema.decodeUnknownSync(Schema.Json)(admitted.values)}); Object.assign(input,{values:row.values}); manualActivityCapture = admitted.capture;
   }
  }
  if (snapshot.voided_at != null || !entryDateCovered(snapshot.effective_range, sourceDay)) {
   if(catalog==='LEAVE'){const lineage=await readAll<Record<string,unknown>>(receiptReads,'jurisdiction_settings',{code:{eq:snapshot.code},approval_id:{isNull:true},voided_at:{isNull:true},sealed_at:{isNull:false,lte:observedAt}});if(!lineage.some(version=>entryDateCovered(version.effective_range,sourceDay)))refuse(`No sealed settings cover ${sourceDay}.`);refuse(`No ${String(Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(definition).code)} leave catalogue covers ${sourceDay}.`);}
   refuse('The original governing snapshot must cover this actual entry date.');
  }
  const entity = sources.get('entities')?.get(row.company_id!);
  if (entity == null || entity.settings_code !== snapshot.code) refuse('The catalog definition must govern the actual entity.');
  if (row.employment_id != null) {
   const profile = sources.get('employee_profiles')?.get(row.employment_id);
   if (profile == null || profile.company_id !== row.company_id) refuse('The entry profile must belong to its actual entity.');
   if (!entryDateCovered(profile.effective_range, sourceDay)) refuse('The actual entry date must fall inside its original native profile.');
  }
  if (!Schema.is(Schema.NonEmptyString)(snapshot.payroll?.timezone)) refuse('Entry documentary admission requires its actual original jurisdiction timezone.');
  const knowledgeDay = calendarDateInTimeZone(new Date(observedAt), snapshot.payroll.timezone);
  const proofDay = occurredOn < knowledgeDay ? occurredOn : knowledgeDay;
  let fundingCapture: unknown = manualActivityCapture;
  if (catalog === 'LEAVE' && prior?.activity === 'TIME_OFF' && Object.hasOwn(input, 'values') && stableJson(row.values) !== stableJson(prior.values)) refuse('An accepted leave taking must retain its exact funded charge and source allocations.');
  if (catalog === 'LEAVE' && prior == null) {
   const requested = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(row.values);
   if(requested.activity==='ENCASHMENT' && manualActivityCapture == null){
    if(source_basis==null||requested.effective_on!==occurredOn||row.employment_id==null)refuse('Departure cash requires its authenticated native lifecycle event and original exit day.');
    if((Array.isArray(requested.allocations)&&requested.allocations.length)||(Array.isArray(requested.charges)&&requested.charges.length))refuse('Departure source debits are derived from actual native earned credit.');
    const quantity=Predicate.isNumber(requested.encash_hours)?requested.encash_hours:requested.encash_days;
    if(!Predicate.isNumber(quantity))refuse('Departure needs its actual declared cash quantity.');
    const funded=await captureNativeLeaveExitDraft(receiptReads,{profile_id:row.employment_id,catalogue_id:definition.id,date:occurredOn,observation:{observedAt,timezone:snapshot.payroll.timezone}});
    const fundedValues=funded==null?undefined:Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(funded.values);
    if(funded==null||fundedValues==null||quantity!==(fundedValues.encash_hours??fundedValues.encash_days)||row.reference!==funded.reference)refuse('Departure retains its exact original native full source quantity and reference.');
    Object.assign(row,{values:Schema.decodeUnknownSync(Schema.Json)({...requested,...funded.values,charges:[]})});
    fundingCapture=Schema.decodeUnknownSync(Schema.Json)({observed_at:observedAt,allocations:funded.values.allocations,funding:funded.capture});Object.assign(input,{values:row.values});
   }
   if (requested.activity === 'TIME_OFF') {
    if (row.employment_id == null) refuse('Leave taking requires its actual native employee profile.');
    if ((requested.charges != null && (!Array.isArray(requested.charges) || requested.charges.length > 0)) || (requested.allocations != null && (!Array.isArray(requested.allocations) || requested.allocations.length > 0))) refuse('Leave charges and funded allocations are maintained by the native catalog configuration.');
    if (['original_event_entitlement','parental_allocation'].some(key=>requested[key]!=null&&stableJson(requested[key])!=='{}'&&stableJson(requested[key])!=='[]')) refuse('Original event entitlement and parental snapshots are derived from qualified native sources.');
    if (requested.from_date !== occurredOn) refuse('Leave taking must retain its exact original request start as the native occurrence date.');
      const draft_id = `batch:${index}`;
    await refuseNativeTransferredPredecessorUsage(receiptReads,{profile_id:row.employment_id,catalogue_id:definition.id,request:requested,observation:{observedAt,timezone:snapshot.payroll.timezone}});
    const measured = await captureNativeLeaveFunding(receiptReads, { draft_id, profile_id: row.employment_id, catalogue_id: definition.id, request: requested, observation: { observedAt, timezone: snapshot.payroll.timezone }, staged_entries: stagedLeave });
    stagedLeave.push({ draft_id, profile_id: row.employment_id, catalogue_id: definition.id, request: structuredClone(requested), charges: measured.charges, allocations: measured.allocations });
    const eventSnapshot=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(plain(measured));
    const maintainedSnapshots=Object.fromEntries(['original_event_entitlement','parental_allocation'].filter(key=>eventSnapshot[key]!=null).map(key=>[key,eventSnapshot[key]]));
    Object.assign(row,{values:Schema.decodeUnknownSync(Schema.Json)({ ...requested, ...maintainedSnapshots, charges: measured.charges, allocations: measured.allocations })});
    fundingCapture = Schema.decodeUnknownSync(Schema.Json)({ observed_at: observedAt, charges: measured.charges, allocations: measured.allocations, funding: measured.funding, frames: measured.frames, ...maintainedSnapshots });
    Object.assign(input,{values:row.values});
   }
  }
  const context = { observedDay: proofDay, observedAt, ...(prior == null ? {} : { previousValue: Schema.decodeUnknownSync(Schema.Json)(prior.values) }), ...(prior?.id == null ? {} : { subjectId: String(prior.id) }), proofFault: () => null };
  const pin = await admitEntryValues({ catalog, catalogue_id: definition.id, settings_id: definition.settings_id!, schema: definition.entry_schema!, values: row.values, context, ...(prior == null ? {} : { original: prior.schema_snapshot as EntrySchemaSnapshot }) });
  const originalProofs = Schema.decodeUnknownSync(Schema.Array(inputProofCapture))(prior?.input_proofs ?? []);
  const candidates = Object.hasOwn(input, 'input_proofs') ? Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(input.input_proofs) : originalProofs.map(({ id, fact_key, reference, file, received_on, expires_on, document_type }) => ({ id, fact_key, reference, file, received_on, expires_on, document_type }));
  const admittedProofs = await admitRuntimeProofs(proofReads, {
   schema: pin.schema, pin, values: row.values, context, subject: { collection: 'catalogue_entries', ...(prior?.id == null ? {} : { id: String(prior.id) }) },
   candidates, files: Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(row.input_files ?? []), original: originalProofs,
   ...(prior?.original_capture == null || prior.source_kind == null ? {} : { originalCatalog: { capture: prior.original_capture, ownerId: String(prior.id), sourceKind: prior.source_kind, reads: ctx.db } }),
   day: proofDay, observation: { observedAt, timezone: snapshot.payroll.timezone }
  });
  await admitEntryValues({ catalog, catalogue_id: definition.id, settings_id: definition.settings_id!, schema: definition.entry_schema!, values: row.values, original: pin, context: { ...context, proofFault: admittedProofs.proofFault } });
  if(catalog==='LEAVE'&&row.employment_id!=null){
   const values=Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(row.values);
   const charges=Array.isArray(values.charges)?Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String,Schema.Json)))(values.charges):[];
   const stage=await captureNativeConfiguredStage(receiptReads,{profile_id:row.employment_id,settings_id:definition.settings_id!,date:sourceDay,stage:'LEAVE_ENTRY',roots:{leave:{code:values.leave_code,from:values.from_date??occurredOn,to:values.to_date??occurredOn,days:Predicate.isNumber(values.days)?values.days:charges.reduce((sum,charge)=>sum+(Predicate.isNumber(charge.days)?charge.days:0),0),facts:values.facts??{}}},observation:{observedAt,timezone:snapshot.payroll.timezone}});
   const blockers=stage.issues.filter(issue=>issue.severity!=='WARNING');if(blockers.length)refuse(blockers.map(issue=>issue.message).join(' '));
   nativeStageCapture=stage;
  }
  const derivedReceipt = source_basis == null ? {} : Predicate.isObject(source_basis)&&source_basis.operation==='SCHEDULED_OCCURRENCE' ? await admitNativeScheduledEffect(receiptReads,source_basis,'catalogue_entries',receiptArgs,observedAt,snapshot.payroll.timezone) : await admitConfiguredCatalogEffect(receiptReads, source_basis, 'catalogue_entries', receiptArgs, observedAt, prior?.id == null ? undefined : String(prior.id), prior);
  const derivedKey=Schema.decodeUnknownSync(Schema.Struct({effect_key:Schema.optional(Schema.Json)}))(derivedReceipt).effect_key;
  const effectHistory = prior?.effect_key == null || derivedKey === prior.effect_key ? prior?.effect_history : [...Schema.decodeUnknownSync(Schema.Array(Schema.Json))(prior.effect_history ?? []), Schema.decodeUnknownSync(Schema.Json)({ effect_key: prior.effect_key, effect_hash: prior.effect_hash, source_basis: prior.source_basis, values: prior.values, schema_snapshot: prior.schema_snapshot, input_proofs: prior.input_proofs ?? [], input_files: prior.input_files ?? [] })];
  if (definition.pricing != null && (Schema.is(Schema.Struct({ admission: Schema.Unknown }))(definition.pricing) || Schema.is(Schema.Struct({ source_programs: Schema.Struct({ admission_program: Schema.Unknown }) }))(definition.pricing))) {
   const profile = row.employment_id == null ? undefined : sources.get('employee_profiles')?.get(row.employment_id);
   if (profile == null) refuse('Configured request admission requires its actual native profile.');
   admissionCapture = await admitConfiguredEntryRequest(receiptReads,{definition,jurisdiction:snapshot,entry:row,...(prior==null?{}:{prior}),profile,entity,staged_requests:stagedRequests,observation:{observedAt,timezone:snapshot.payroll.timezone}});
  }
  stagedRequests.push(structuredClone(row));
  const entered = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(row.values);
  if (entered.id != null && (prior?.id == null || entered.id !== String(prior.id))) refuse('An entry body cannot invent or replace its actual native identity.');
  const sourceKind = entered.source_kind;
  if (sourceKind != null && (!Schema.is(Schema.NonEmptyString)(sourceKind) || !sourceKind.trim())) refuse('Catalog source families must retain their original admitted discriminator.');
  if (prior?.source_kind != null && sourceKind !== prior.source_kind) refuse('A catalog record cannot change its original source family.');
  const activity = catalog === 'LEAVE' && entered.activity != null ? Schema.decodeUnknownSync(Schema.Literals(['TIME_OFF', 'ENCASHMENT', 'CARRY_FORWARD', 'ADJUSTMENT', 'REVERSAL', 'RETURN_CHANGE']))(entered.activity) : undefined;
  if (prior?.activity != null && activity !== prior.activity) refuse('A leave record cannot change its original admitted activity.');
  result.push({ ...input, ...(fundingCapture == null ? {} : { funding_capture: Schema.decodeUnknownSync(Schema.Json)(fundingCapture) }), ...(admissionCapture == null && nativeStageCapture == null ? {} : { admission_capture: Schema.decodeUnknownSync(Schema.Json)({...(admissionCapture == null ? {} : Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(plain(admissionCapture))),...(nativeStageCapture == null ? {} : {native_stage:nativeStageCapture})}) }), input_proofs: Schema.decodeUnknownSync(Schema.Json)(admittedProofs.records), ...derivedReceipt, ...(effectHistory == null ? {} : { effect_history: effectHistory }), ...(sourceKind == null ? {} : { source_kind: sourceKind }), ...(activity == null ? {} : { activity }), schema_snapshot: Schema.decodeUnknownSync(Schema.Json)(pin) });
 }
 return result;
});


// Each handler calls a literal native verb. Configurations cannot select arbitrary callables.
c.action('execute_event', async (input, ctx) => {
 const receiptReads = memoizedReads(ctx);
 const deferredCreates: Insert<'catalogue_entries'>[] = [];
 if ((input.profile_id == null) === (input.entity_id == null)) refuse('A configured event requires exactly one actual profile or entity subject.');
 const versions = await readAll<{ id: string; payroll: { timezone: string } }>(ctx, 'jurisdiction_settings', { id: { eq: input.snapshot_id }, approval_id: { isNull: true } }, undefined, { id: true, payroll: true }, 1);
 const version = versions[0];
 if (versions.length !== 1 || version?.id !== String(input.snapshot_id) || !Schema.is(Schema.NonEmptyString)(version?.payroll?.timezone)) refuse('A configured event requires its actual jurisdiction payroll timezone.');
 const subject = input.profile_id == null ? { collection: 'entities' as const, id: String(input.entity_id) } : { collection: 'employee_profiles' as const, id: String(input.profile_id) };
 let sourceRequest: CatalogEffectSource | undefined;
 if (input.source_entry_id != null) {
  if (input.source_collection != null || input.source_id != null || input.source_revision != null) refuse('A native catalog event names exactly one original source.');
  const entries = await readAll<{ id: string; revision: number }>(ctx, 'catalogue_entries', { id: { eq: input.source_entry_id }, approval_id: { isNull: true } }, undefined, { id: true, revision: true }, 1);
  if (entries.length !== 1 || entries[0]?.id !== String(input.source_entry_id)) refuse('A catalog event requires its actual approved source entry.');
  sourceRequest = { source_collection: 'catalogue_entries', source_id: entries[0].id, source_revision: entries[0].revision, event_kind: 'ENTRY_ACCEPTED', catalog: input.catalog, ...(input.profile_id == null ? {} : { profile_id: String(input.profile_id) }) };
 } else if (input.source_collection != null || input.source_id != null || input.source_revision != null) {
  if (input.source_collection == null || input.source_id == null || (input.source_collection!=='entities'&&input.source_revision == null) || !['ENTRY_ACCEPTED','HIRE','EXIT','RUN_FINALISED','CASE_EVENT'].includes(input.event_kind)) refuse('A lifecycle event requires its complete actual source identity and revision.');
  sourceRequest = { source_collection: input.source_collection, source_id: input.source_id, ...(input.source_revision==null?{}:{source_revision:input.source_revision}), ...(input.source_family==null?{}:{source_family:input.source_family}),...(input.source_record_id==null?{}:{source_record_id:input.source_record_id}), event_kind: input.event_kind as CatalogEffectSource['event_kind'], catalog: input.catalog, ...(input.profile_id == null ? {} : { profile_id: String(input.profile_id) }) };
 }
 const nativeOptions = sourceRequest == null ? undefined : await prepareNativeCatalogSourceEvent(ctx, sourceRequest, String(ctx.now));
 if (nativeOptions != null && (nativeOptions.snapshot_id !== String(input.snapshot_id) || nativeOptions.configuration_hash !== input.configuration_hash || nativeOptions.day !== String(input.day) || nativeOptions.event.kind !== input.event_kind || nativeOptions.event.subject.collection !== subject.collection || nativeOptions.event.subject.id !== subject.id)) refuse('A lifecycle event must retain its actual native source, subject, governing pin and event date.');
 if (input.original_event_hash != null && input.original_event_hash !== nativeOptions?.event.data?.original_event_hash) refuse('A native event must retain its immutable original source and governing capture.');
 async function receipt(target: 'catalogue_entries' | 'obligations', args: Readonly<Record<string, unknown>>, slot: { key: string; capture_hash: string; rule_id: string; operation_id: string }) {
  if (sourceRequest == null) return { replayed: false, source_basis: undefined };
  const source_basis = { ...sourceRequest, rule_id: slot.rule_id, operation_id: slot.operation_id };
  const admitted = await admitConfiguredCatalogEffect(receiptReads, source_basis, target, args, String(ctx.now));
  if (admitted.effect_key !== `${slot.key}:${slot.rule_id}:${slot.operation_id}` || admitted.effect_hash !== slot.capture_hash) refuse('Configured operation source changed during native admission.');
  const previous = await readAll<{ id: string; effect_hash: string }>(ctx, target, { effect_key: { eq: admitted.effect_key } }, undefined, { id: true, effect_hash: true }, 1);
  if (previous.length > 1 || (previous.length === 1 && previous[0]?.effect_hash !== admitted.effect_hash)) refuse('A source event cannot reinterpret its original committed operation receipt.');
  return { ...admitted, source_basis, replayed: previous.length === 1 };
 }
 const result = await stageConfiguredBehaviourExecution(ctx, nativeOptions ?? {
  event: { id: ctx.invocationId, kind: input.event_kind, subject }, catalog: input.catalog,
  snapshot_id: String(input.snapshot_id), configuration_hash: input.configuration_hash, day: String(input.day),
  observation: { observedAt: String(ctx.now), timezone: version.payroll.timezone }
 }, {
  APPLY: { target: 'catalogue_entries', async stage(args, slot) {
   if (sourceRequest == null) refuse('Batch effects require an actual immutable native source event.');
   const batch = Schema.decodeUnknownSync(Schema.Struct({ rows: Schema.Array(Schema.Struct({ operation: Schema.Literals(['CREATE','UPDATE','DELETE']), key: Schema.NonEmptyString, target_id: Schema.optional(Schema.NullOr(Schema.NonEmptyString)), values: Schema.optional(Schema.Record(Schema.String, Schema.Json)) })) }))(args, { onExcessProperty: 'error' }).rows;
   if (batch.length > 1200 || new Set(batch.map(row => row.key)).size !== batch.length) refuse('A configured batch requires bounded unique operation identities.');
   const ids = batch.flatMap(row => row.target_id == null ? [] : [row.target_id]);
   if (new Set(ids).size !== ids.length) refuse('A configured batch cannot mutate one native target twice.');
   const originals = await readAll<{ id: Id<'catalogue_entries'>; company_id: string; employment_id: string | null; catalog: string; catalogue_id: string; source_kind: string; payslip_id: unknown; values: Record<string, unknown>; approval_id: unknown }>(ctx, 'catalogue_entries', { id: { in: ids }, approval_id: { isNull: true } });
   const committed = await readAll<{id:string;effect_key:string;effect_hash:string}>(ctx,'catalogue_entries',{effect_key:{in:batch.filter(row => row.operation !== 'DELETE').map(row => `${slot.key}:${slot.rule_id}:${slot.operation_id}:${row.key}`)}},undefined,{id:true,effect_key:true,effect_hash:true});
   const writes: (Insert<'catalogue_entries'> | ({ id: Id<'catalogue_entries'> } & Patch<'catalogue_entries'>))[] = [], deletes: Id<'catalogue_entries'>[] = [];
   for (const row of batch) {
    const original = row.target_id == null ? undefined : originals.find(item => item.id === row.target_id);
    if (row.operation !== 'CREATE' && (original == null || original.approval_id != null || original.payslip_id != null || original.source_kind !== 'loan_repayments' || original.catalog !== input.catalog || original.employment_id !== String(input.profile_id))) refuse('Configured schedule mutations require actual approved unpinned repayments owned by the event profile.');
    if (row.operation === 'DELETE') { deletes.push(original!.id); continue; }
    if (row.values == null || (row.operation === 'CREATE' && row.target_id != null)) refuse('Configured batch writes require their exact original payload.');
    const authored = row.values;
    const values = row.operation === 'CREATE' ? authored : Object.fromEntries(['reference','occurred_on','values','input_proofs','input_files'].filter(key => Object.hasOwn(authored,key)).map(key => [key, key === 'values' ? { ...original!.values, ...Schema.decodeUnknownSync(Schema.Record(Schema.String,Schema.Json))(authored.values) } : authored[key]]));
    const basis = { ...sourceRequest, rule_id: slot.rule_id, operation_id: slot.operation_id, row_key: row.key };
    const admitted = await admitConfiguredCatalogEffect(receiptReads, basis, 'catalogue_entries', values, String(ctx.now), original?.id, original);
    if (admitted.effect_hash !== slot.capture_hash) refuse('The actual captured batch changed during native admission.');
    const previous = committed.filter(item => item.effect_key === admitted.effect_key);
    if (previous.length && (previous[0]?.effect_hash !== admitted.effect_hash || (original != null && previous[0]?.id !== original.id))) refuse('A batch receipt cannot reinterpret its original native target.');
    if (previous.length) continue;
    const staged=Schema.decodeUnknownSync(Schema.Struct({
     company_id: Schema.optional(Schema.NonEmptyString), employment_id: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
     catalog: Schema.optional(Schema.Literals(['LEAVE','CLAIM','ADHOC','LOAN','CONTRIBUTION'])),
     catalogue_id: Schema.optional(Schema.NonEmptyString), reference: Schema.optional(Schema.NonEmptyString),
     occurred_on: calendarDay, values: Schema.optional(Schema.Json), input_proofs: Schema.optional(Schema.Json),
     input_files: Schema.optional(Schema.Array(Schema.Struct({id:Schema.NonEmptyString,name:Schema.NonEmptyString,mime:Schema.NonEmptyString})))
    }))(values);
    const occurredOn=PlainDate(staged.occurred_on);
    if(original==null)writes.push({ company_id: staged.company_id as Id<'entities'>, catalog: staged.catalog as Insert<'catalogue_entries'>['catalog'], catalogue_id: staged.catalogue_id as string, reference: staged.reference as string, occurred_on: occurredOn, values: staged.values as Schema.Json, ...(staged.employment_id==null?{}:{employment_id: staged.employment_id as Id<'employee_profiles'>}), ...(staged.input_proofs==null?{}:{input_proofs: staged.input_proofs}), ...(staged.input_files==null?{}:{input_files: staged.input_files as FileRef[]}), source_basis: Schema.decodeUnknownSync(Schema.Json)(basis) });
    else writes.push({ id: original.id, occurred_on: occurredOn, source_basis: Schema.decodeUnknownSync(Schema.Json)(basis), ...(staged.reference==null?{}:{reference: staged.reference}), ...(staged.values==null?{}:{values: staged.values}), ...(staged.input_proofs==null?{}:{input_proofs: staged.input_proofs}), ...(staged.input_files==null?{}:{input_files: staged.input_files as FileRef[]}) });
   }
   if (writes.length) await ctx.act('catalogue_entries.upsert', writes, { onConflict: 'update' });
   if (deletes.length) await ctx.act('catalogue_entries.delete', { target: deletes });
  } },
  RAISE: { target: 'obligations', async stage(args, slot) {
   const values = Schema.decodeUnknownSync(Schema.Struct({
    company_id: Schema.NonEmptyString, settings_id: Schema.NonEmptyString,
    duty_code: Schema.NonEmptyString, subject_kind: Schema.Literals(['COMPANY', 'EMPLOYMENT', 'RUN', 'CASE']),
    subject_id: Schema.NonEmptyString, trigger_ref: Schema.NonEmptyString,
    triggered_on: calendarDay, due_on: calendarDay,
    amount_due: Schema.optional(Schema.Number), recipient_id: Schema.optional(Schema.NonEmptyString),
    facts: Schema.Record(Schema.String, Schema.Union([Schema.Boolean, Schema.Number, Schema.String]))
   }))(args, { onExcessProperty: 'error' });
   const owners = await readAll<{ id: Id<'entities'> }>(ctx, 'entities', { id: { eq: values.company_id }, approval_id: { isNull: true } }, undefined, { id: true }, 1);
   const snapshots = await readAll<{ id: Id<'jurisdiction_settings'> }>(ctx, 'jurisdiction_settings', { id: { eq: values.settings_id }, approval_id: { isNull: true } }, undefined, { id: true }, 1);
   if (owners.length !== 1 || owners[0]?.id !== values.company_id || snapshots.length !== 1 || snapshots[0]?.id !== values.settings_id || values.settings_id !== String(input.snapshot_id)) refuse('Configured duties require their actual caller-readable owner and captured governing snapshot.');
   if (input.entity_id != null && values.company_id !== String(input.entity_id)) refuse('A configured duty must retain its event entity.');
   if (input.profile_id != null && (values.subject_kind !== 'EMPLOYMENT' || values.subject_id !== String(input.profile_id))) refuse('A configured duty must retain its event profile.');
   const saved = await receipt('obligations', values, slot);
   if (saved.replayed) return;
   const { amount_due, recipient_id, ...requiredValues } = values;
   await ctx.act('obligations.create', {
    ...(saved.source_basis == null ? {} : { source_basis: Schema.decodeUnknownSync(Schema.Json)(saved.source_basis) }),
    ...requiredValues,
    ...(amount_due == null ? {} : { amount_due }),
    ...(recipient_id == null ? {} : { recipient_id }),
    company_id: owners[0].id, settings_id: snapshots[0].id,
    triggered_on: PlainDate(values.triggered_on), due_on: PlainDate(values.due_on)
   });
  } },
  CREATE: { target: 'catalogue_entries', async stage(args, slot) {
   const values = Schema.decodeUnknownSync(Schema.Struct({
    company_id: Schema.NonEmptyString, employment_id: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
    catalog: Schema.Literals(['LEAVE','CLAIM','ADHOC','LOAN','CONTRIBUTION']), catalogue_id: Schema.NonEmptyString,
    reference: Schema.NonEmptyString, occurred_on: calendarDay, values: Schema.Json,
    input_proofs: Schema.optional(Schema.Array(Schema.Unknown)), input_files: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, name: Schema.NonEmptyString, mime: Schema.NonEmptyString })))
   }))(args, { onExcessProperty: 'error' });
   const answers = await Promise.allSettled([
    readAll<{ id: Id<'entities'>; approval_id: unknown }>(ctx, 'entities', { id: { eq: values.company_id }, approval_id: { isNull: true } }, undefined, { id: true, approval_id: true }, 1),
    values.employment_id == null ? Promise.resolve([]) : readAll<{ id: Id<'employee_profiles'>; company_id: Id<'entities'>; approval_id: unknown }>(ctx, 'employee_profiles', { id: { eq: values.employment_id }, approval_id: { isNull: true } }, undefined, { id: true, company_id: true, approval_id: true }, 1)
   ]);
   for (const answer of answers) if (answer.status === 'rejected') throw answer.reason;
   const [entities, profiles] = answers;
   if (entities.status !== 'fulfilled' || profiles.status !== 'fulfilled') refuse('Configured entry native owners are unavailable.');
   const entity = entities.value[0], profile = profiles.value[0];
   if (entities.value.length !== 1 || entity?.id !== values.company_id || entity.approval_id != null) refuse('Configured entries require their actual caller-readable approved entity.');
   if (values.employment_id != null && (profiles.value.length !== 1 || profile?.id !== values.employment_id || profile.company_id !== entity.id || profile.approval_id != null)) refuse('Configured entries require their actual caller-readable approved profile.');
   const saved = await receipt('catalogue_entries', values, slot);
   if (saved.replayed) return;
   deferredCreates.push({
    ...(saved.source_basis == null ? {} : { source_basis: Schema.decodeUnknownSync(Schema.Json)(saved.source_basis) }),
    company_id: entity.id, ...(profile == null ? {} : { employment_id: profile.id }),
    catalog: values.catalog, catalogue_id: values.catalogue_id, reference: values.reference,
    occurred_on: PlainDate(values.occurred_on), values: values.values,
    ...(values.input_proofs == null ? {} : { input_proofs: Schema.decodeUnknownSync(Schema.Json)(values.input_proofs) }),
    ...(values.input_files == null ? {} : { input_files: Schema.decodeUnknownSync(Schema.Array(Schema.Struct({id:Schema.NonEmptyString,name:Schema.NonEmptyString,mime:Schema.NonEmptyString})))(values.input_files) as FileRef[] })
   });
  } }
 });
 if (deferredCreates.length) await ctx.act('catalogue_entries.create', deferredCreates);
 return Schema.decodeUnknownSync(Schema.Json)(result);
});

c.project((row,ctx)=>projectCatalogOriginal(row,ctx));

async function leaveQueryObservation(reads:import('../../../lib/payroll_engine/foundation/reads.js').Reads,catalogueId:string,now:unknown) {
 const definitions=await readAll<{id:string;settings_id:string}>(reads,'leave_catalogue',{id:{eq:catalogueId},approval_id:{isNull:true}},undefined,{id:true,settings_id:true},1);
 if(definitions.length!==1)refuse('Leave queries require their actual approved catalogue.');
 const versions=await readAll<{id:string;payroll:{timezone:string}}>(reads,'jurisdiction_settings',{id:{eq:definitions[0]!.settings_id},approval_id:{isNull:true}},undefined,{id:true,payroll:true},1);
 const timezone=versions[0]?.payroll?.timezone;if(versions.length!==1||!Predicate.isString(timezone)||!timezone.trim()||!isOffsetIsoInstant(String(now)))refuse('Leave queries require their actual jurisdiction timezone and native observation.');
 return {observedAt:String(now),timezone};
}
c.query('loan_plan',async(input,ctx)=>{
 const loans=await readAll<Record<string,unknown>>(ctx,'catalogue_entries',{id:{eq:String(input.loan_id)},catalog:{eq:'LOAN'},approval_id:{isNull:true}},undefined,{id:true,catalogue_id:true},1);
 if(loans.length!==1||!Predicate.isString(loans[0]!.catalogue_id))refuse('Loan plan query requires its actual approved agreement.');
 const definitions=await readAll<{settings_id:string}>(ctx,'loan_catalogue',{id:{eq:loans[0]!.catalogue_id},approval_id:{isNull:true}},undefined,{settings_id:true},1);
 if(definitions.length!==1)refuse('Loan plan query requires its actual original catalogue.');
 const versions=await readAll<{payroll:{timezone:string}}>(ctx,'jurisdiction_settings',{id:{eq:definitions[0]!.settings_id},approval_id:{isNull:true},sealed_at:{isNull:false,lte:String(ctx.now)}},undefined,{payroll:true},1);
 const loanVersion=versions[0];
 if(versions.length!==1||loanVersion==null||!Predicate.isString(loanVersion.payroll?.timezone))refuse('Loan plan query retains its actual observed employer timezone.');
 return Schema.decodeUnknownSync(Schema.Json)(await captureNativeLoanPlan(ctx,{loan_id:String(input.loan_id),observation:{observedAt:String(ctx.now),timezone:loanVersion.payroll.timezone}}));
});

c.query('leave_summary',async(input,ctx)=>{
 const observation=await leaveQueryObservation(ctx,String(input.catalogue_id),ctx.now);
 return Schema.decodeUnknownSync(Schema.Json)(await captureNativeLeaveSummary(ctx,{profile_id:String(input.profile_id),catalogue_id:String(input.catalogue_id),date:String(input.as_of),observation}));
});
c.query('preview_leave',async(input,ctx)=>{
 const observation=await leaveQueryObservation(ctx,String(input.catalogue_id),ctx.now);
 return Schema.decodeUnknownSync(Schema.Json)(await captureNativeLeavePreview(ctx,{...plain(input),profile_id:String(input.profile_id),catalogue_id:String(input.catalogue_id)} as import('../../../lib/payroll_engine/catalogues/entries.js').NativeLeavePreviewInput,observation));
});

c.query('leave_balance_report',async(input,ctx)=>{
 const companies=await readAll<{id:string;settings_code:string}>(ctx,'entities',{id:{eq:String(input.company_id)},approval_id:{isNull:true}},undefined,{id:true,settings_code:true},1);if(companies.length!==1)refuse('Leave report requires its actual approved employer.');
 const versions=await readAll<{id:string;payroll:{timezone:string}}>(ctx,'jurisdiction_settings',{code:{eq:companies[0]!.settings_code},approval_id:{isNull:true},sealed_at:{isNull:false,lte:String(ctx.now)},voided_at:{isNull:true}},undefined,{id:true,payroll:true});
 const timezones=[...new Set(versions.map(version=>version.payroll?.timezone))];if(timezones.length!==1||!Predicate.isString(timezones[0]))refuse('Leave report requires its actual native employer timezone.');
 return Schema.decodeUnknownSync(Schema.Json)(await captureNativeLeaveBalanceReport(ctx,{company_id:String(input.company_id),as_of:String(input.as_of),...(input.after==null?{}:{after:String(input.after)}),observation:{observedAt:String(ctx.now),timezone:timezones[0]}}));
});
