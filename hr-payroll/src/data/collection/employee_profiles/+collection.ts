import {queryNativeHistoryDays,queryNativeHistorySlips} from '../../../lib/history-source.js';
import {normalizeInputCandidate} from '../../../lib/payroll_engine/datatypes/input-schema.js';
import {captureNativeProfileStart} from '../../../lib/profile-start-source.js';
import {captureNativeProfileAdmission,sealNativeProfileMutation} from '../../../lib/payroll_engine/admission/profile-admission.js';
import {captureNativeProfileLifecycle} from '../../../lib/profile-lifecycle-source.js';
import {captureNativeConfiguredStage} from '../../../lib/payroll_engine/execution/configured-execution.js';
import {captureNativeColumnAdmission,appendNativeColumnAdmission} from '../../../lib/payroll_engine/admission/input-column-admission.js';
import { projectNativeInputs, enforceOriginalInputWrites, type InputWriteAccess } from '../../../lib/payroll_engine/admission/input-access.js';
import { collection, type Id } from '@norbital-ai/bolt';
import { Schema } from 'effect';
import { plain } from '../../../lib/payroll_engine/foundation/primitives.js';
import { admitNativeInputUpdates, admitRuntimeInput, profileContractOwnerFault, type InputSchemaSource } from '../../../lib/payroll_engine/admission/input-schema-admission.js';
import { governed, settingsInForce } from '../../../lib/payroll_engine/admission/schema-version.js';
import { readAll, type Reads } from '../../../lib/payroll_engine/foundation/reads.js';
import { refuse } from '../../../lib/payroll_engine/foundation/primitives.js';
import { runtimeProofReads } from '../../../lib/payroll_engine/admission/runtime-proof.js';
import { inputSchemaForScope, type InputSchema } from '../../../lib/payroll_engine/datatypes/input-schema.js';
import { isOffsetIsoInstant, isCalendarDate } from '../../../lib/payroll_engine/foundation/time.js';
import {initialNativeInputFamilies,captureInitialNativeInputFamilies} from '../../../lib/payroll_engine/admission/facts.js';
import {createNativeAdmissionGraph,bindNativeAdmissionOwner,acceptNativeAdmissionOwner} from '../../../lib/payroll_engine/admission/owner-graph.js';
import * as Predicate from 'effect/Predicate';

/** The first column admission issue's actual native message. */
const columnFault = Schema.decodeUnknownSync(Schema.Struct({ message: Schema.String }));
const profileDecision = Schema.decodeUnknownSync(Schema.Struct({ leaving: Schema.optional(Schema.Boolean), delete_days: Schema.optional(Schema.Array(Schema.String)), delete_rosters: Schema.optional(Schema.Array(Schema.String)), clear_encashment: Schema.optional(Schema.Boolean) }));

const c = collection('employee_profiles', {
 actions:{change_terms:{description:'Close an actual predecessor contract and admit its next-day successor through the native profile bank.',input:{profile_id:{kind:'id',of:'employee_profiles'},previous_id:{kind:'text'},starts_on:{kind:'date'},closes_on:{kind:'date',optional:true},facts:{kind:'json'},input_proofs:{kind:'json',optional:true},input_files:{kind:'file',accept:['*/*'],max:'20MiB',multiple:true,optional:true}},output:{kind:'json'}}},
 queries:{history_days:{description:'Query qualified historical attendance using actual caller-readable source captures.',input:{profile_id:{kind:'id',of:'employee_profiles'},settings_id:{kind:'id',of:'jurisdiction_settings'},date:{kind:'date'},from:{kind:'date'},to:{kind:'date'}},output:{kind:'json'}},history_slips:{description:'Query saved settlements and separately admitted documentary wage history.',input:{profile_id:{kind:'id',of:'employee_profiles'},settings_id:{kind:'id',of:'jurisdiction_settings'},date:{kind:'date'},from:{kind:'date'},to:{kind:'date'}},output:{kind:'json'}}},
 read: { fields: 'all', projection: { fields: ['facts','input_originals','input_history','input_proofs','input_files','input_census','input_column_history'], context: ['input_schema_snapshot', 'input_originals', 'facts', 'input_proofs', 'input_files'] } },
 create: { input: { columns: ['employee_id','company_id','employee_number','effective_range','signed_contract_end','prior_service_months','bank','comments','facts','input_proofs','input_files','exit_ground','exit_facts','lifecycle_source_file','lifecycle_source_references','retirement_source','retirement_source_file','retirement_source_references'] } },
 update: { input: { columns: ['employee_id','company_id','employee_number','effective_range','signed_contract_end','prior_service_months','bank','comments','facts','input_proofs','input_files','exit_ground','exit_facts','lifecycle_source_file','lifecycle_source_references','retirement_source','retirement_source_file','retirement_source_references','encashment_due_on','encashment_raised_at'] } }
});
export default c;
c.query('history_days',async(input,ctx)=>Schema.decodeUnknownSync(Schema.Json)(await queryNativeHistoryDays(ctx,{profile_id:String(input.profile_id),settings_id:String(input.settings_id),date:String(input.date),days_from:String(input.from),window:{from:String(input.from),to:String(input.to)},observation:{observedAt:String(ctx.now),timezone:ctx.tz}})));
c.query('history_slips',async(input,ctx)=>Schema.decodeUnknownSync(Schema.Json)(await queryNativeHistorySlips(ctx,{profile_id:String(input.profile_id),settings_id:String(input.settings_id),date:String(input.date),window:{from:String(input.from),to:String(input.to)},observation:{observedAt:String(ctx.now),timezone:ctx.tz}})));
c.transform(async (inputs, ctx) => {
 const existing = structuredClone(ctx.existing);
 const clock = { observedAt: String(ctx.now), timezone: ctx.tz, day: String(ctx.today) };
 if (existing.some(row => row == null)) {
  if (existing.some(row => row != null)) ctx.refuse('Create and update employment inputs in separate native batches.');
  const roots=ctx.staged.filter(row=>row.collection==='employee_profiles'&&row.parent==null);
  if(roots.length!==inputs.length)ctx.refuse('Employment creation requires its actual engine-assigned batch identities.');
  return admitProfileCreates(inputs, createNativeAdmissionGraph(ctx.db,ctx.staged), clock, false, {actor:ctx.actor,policies:ctx.policies,admin:ctx.admin,get:ctx.db.get as InputWriteAccess['get']},roots.map(row=>({id:row.id})));
 }
 const nativeInputs=inputs.map(input=>plain(input)),priors=existing.map(row=>plain(row!));
 const dynamic=nativeInputs.map(input=>Object.fromEntries(Object.entries(input).filter(([key])=>['facts','input_proofs','input_files'].includes(key))));
 const captures=await admitNativeInputUpdates(ctx.db,'employee_profiles',dynamic,priors,clock,{inputAccess:{actor:ctx.actor,policies:ctx.policies,admin:ctx.admin,get:ctx.db.get as InputWriteAccess['get']}});
 return Promise.all(captures.map(async(capture,index)=>{
  const input=nativeInputs[index]!,previous=priors[index]!,row={...previous,...input,...capture};
  const structural=await captureNativeProfileAdmission(ctx.db,{input,previous,candidate:row,observation:clock});
  const columns=await captureNativeColumnAdmission(ctx.db,{subjects:[{collection:'employee_profiles',row,previous,lineages:[String(structural.setting.code)],record_id:String(previous.id)}],observation:clock,governing_ids:[String(structural.setting.id)],day:structural.day});
  if(columns.issues.length)ctx.refuse(columnFault(columns.issues[0]!).message);
  const documentary=await captureNativeProfileLifecycle(ctx.db,{row,previous,observation:clock,setting:structural.setting});
  const candidate={...row,...documentary},decision=profileDecision(structural.decision);
  if(decision.leaving===true){
   const capability=await sealNativeProfileMutation(candidate,previous,{structural,columns,documentary});
   const checked=await captureNativeConfiguredStage(ctx.db,{profile_id:String(previous.id),settings_id:String(structural.setting.id),date:structural.day,stage:'EXIT',admittedProfileMutation:capability,observation:clock});
   const blocker=checked.issues.find(issue=>issue.severity==='BLOCKER');if(blocker)ctx.refuse(blocker.message);
  }
  const columnHistory=await appendNativeColumnAdmission({...previous,input_column_history:('input_column_history' in capture?capture.input_column_history:undefined)??previous.input_column_history},{collection:'employee_profiles',id:String(previous.id)},[columns],clock);
  const captured=Schema.decodeUnknownSync(Schema.Struct({facts:Schema.Unknown,input_schema_snapshot:Schema.Unknown,input_proofs:Schema.Unknown,input_files:Schema.optional(Schema.Unknown),input_history:Schema.optional(Schema.Unknown),input_originals:Schema.optional(Schema.Unknown),input_census:Schema.optional(Schema.Unknown)}))(capture);
  const json=(value:unknown)=>Schema.decodeUnknownSync(Schema.Json)(value);
  const days=decision.delete_days,rosters=decision.delete_rosters;
  return {...inputs[index]!,facts:json(captured.facts),input_schema_snapshot:json(captured.input_schema_snapshot),input_proofs:json(captured.input_proofs),...(captured.input_files===undefined?{}:{input_files:inputs[index]!.input_files??previous.input_files??[]}),...(captured.input_history===undefined?{}:{input_history:json(captured.input_history)}),...(captured.input_originals===undefined?{}:{input_originals:json(captured.input_originals)}),...(captured.input_census===undefined?{}:{input_census:json(captured.input_census)}),...documentary,input_column_history:json(columnHistory.input_column_history),...(Array.isArray(days)&&days.length?{roster_entries:{delete:days}}:{}),...(Array.isArray(rosters)&&rosters.length?{rosters:{delete:rosters}}:{}),...(decision.clear_encashment===true?{encashment_due_on:null}:{})};
 }));
});

/** Parent employee transforms validate their native inverse children before the atomic write. */
export async function admitProfileCreates<R extends Readonly<Record<string, unknown>>>(inputs: readonly R[], reads: Reads, clock: { observedAt:string;timezone:string;day:string }, nestedPerson = false, inputAccess?: InputWriteAccess, identities?:readonly {readonly id:string;readonly employee_id?:string}[]): Promise<R[]> {
 const ctx = { db:reads, refuse };
  if (!isOffsetIsoInstant(clock.observedAt) || !isCalendarDate(clock.day)) refuse('Employment admission requires its actual server observation clock.');
  const rows: Record<string, unknown>[] = inputs.map(row=>structuredClone(plain({...row})));
  if(identities?.length!==rows.length||new Set(identities.map(row=>row.id)).size!==rows.length||identities.some(row=>!row.id.trim()))refuse('Employment admission requires its real assigned native identities.');
  for (const [index,row] of rows.entries()) {
   if (Object.keys(row).some(key => !['employee_id','company_id','employee_number','effective_range','signed_contract_end','prior_service_months','bank','comments','facts','input_proofs','input_files','exit_ground','exit_facts','lifecycle_source_file','lifecycle_source_references','retirement_source','retirement_source_file','retirement_source_references'].includes(key))) ctx.refuse('Employment creation cannot supply maintained pins, history or lifecycle assessments.');
   if ((!nestedPerson && !Schema.is(Schema.NonEmptyString)(row.employee_id)) || !Schema.is(Schema.NonEmptyString)(row.company_id) || !Schema.is(Schema.NonEmptyString)(row.employee_number) || !String(row.employee_number).trim()) ctx.refuse('Employment creation requires its actual person, employer and employee number.');
   if (nestedPerson && Object.hasOwn(row, 'employee_id')) ctx.refuse('Nested employment ownership is assigned only by the native parent relationship.');
   if(nestedPerson&&!identities[index]!.employee_id?.trim())ctx.refuse('Nested employment requires its actual engine-assigned parent identity.');
   const initialFacts=Schema.is(Schema.Record(Schema.String,Schema.Json))(row.facts)?row.facts:undefined;
   if(initialFacts!=null){
    const terms=initialFacts.contract_terms;
    if(Array.isArray(terms))for(const term of terms){if(!Schema.is(Schema.Record(Schema.String,Schema.Json))(term))continue;if(term.employment_id!=null&&term.employment_id!==identities[index]!.id)ctx.refuse('Initial contracts cannot name another native profile.');term.employment_id=identities[index]!.id;}
   }
   const period = governed(row.effective_range);
   if (period == null) refuse('Employment creation requires its actual ordered service period.');
   if (row.signed_contract_end != null && (!Predicate.isString(row.signed_contract_end) || governed({ from: period.from, to: row.signed_contract_end }) == null)) ctx.refuse('The signed contract end must retain its actual service period.');
   const fault = profileContractOwnerFault(row.facts,identities[index]!.id);
   if (fault != null) ctx.refuse(fault);
  }
  const companyIds = rows.map(row => String(row.company_id));
  const employeeIds = nestedPerson ? [] : rows.map(row => String(row.employee_id));
  const [companies, employees, proofReads] = await Promise.all([
   readAll<{ id:string;settings_code:string;approval_id?:unknown }>(ctx.db,'entities',{id:{in:[...new Set(companyIds)]},approval_id:{isNull:true}},undefined,{id:true,settings_code:true,approval_id:true}),
   readAll<{ id:string;approval_id?:unknown }>(ctx.db,'employees',{id:{in:[...new Set(employeeIds)]},approval_id:{isNull:true}},undefined,{id:true,approval_id:true}),
   runtimeProofReads(ctx.db,rows.map(row => ({collection:'employee_profiles',files:row.input_files ?? []})))
  ]);
  for (const [records, requested] of [[companies,companyIds],[employees,employeeIds]] as const) {
   const seen = new Set<string>();
   for (const record of records) { if (!requested.includes(record.id) || seen.has(record.id) || record.approval_id != null) ctx.refuse('Employment owners must be unique actual approved native records.'); seen.add(record.id); }
   if (seen.size !== new Set(requested).size) ctx.refuse('The actual approved employment person or employer is unavailable.');
  }
  type Version = InputSchemaSource & { employee_input_schema: InputSchema; effective_range:unknown;voided_at?:unknown };
  const codes = [...new Set(companies.map(company => company.settings_code))];
  const versions = await readAll<Version>(ctx.db,'jurisdiction_settings',{code:{in:codes},approval_id:{isNull:true},sealed_at:{isNull:false,lte:clock.observedAt},voided_at:{isNull:true}},undefined,{id:true,code:true,sealed_at:true,approval_id:true,voided_at:true,effective_range:true,employee_input_schema:true,payroll:true,behaviours:true,exit_facts:true});
  const seen = new Set<string>();
  for (const version of versions) {
   if (seen.has(version.id) || !codes.includes(version.code) || version.approval_id != null || version.voided_at != null || !isOffsetIsoInstant(version.sealed_at) || Date.parse(version.sealed_at) > Date.parse(clock.observedAt)) ctx.refuse('Employment inputs require actual unique approved sealed jurisdiction versions.');
   seen.add(version.id);
  }
  return Promise.all(rows.map(async (row,index) => {
   const code = companies.find(company => company.id === row.company_id)!.settings_code;
   const governing = settingsInForce(versions,code,clock.day);
   if (governing == null) refuse('Employment inputs require their actual governing schema at admission.');
   const schema=inputSchemaForScope(governing.employee_input_schema,'employment_terms');
   row.facts=normalizeInputCandidate(schema,initialNativeInputFamilies(schema,row.facts));
   // Profile-owned fact rows take their actual owner: the assigned profile, and its employee where declared.
   if(Predicate.isObject(row.facts))for(const [key,node] of Object.entries(schema.properties??{})){
    const bank=row.facts[key];if(!Array.isArray(bank))continue;
    const items=Predicate.isObject(node.items)?node.items:{},properties=Predicate.isObject(items)?(items.properties??{}):{};
    for(const raw of bank)if(Predicate.isObject(raw)){
     if(properties['employment_id']!=null&&raw.employment_id==null)raw.employment_id=identities[index]!.id;
     if(properties['employee_id']!=null&&raw.employee_id==null)raw.employee_id=nestedPerson?identities[index]!.employee_id:row.employee_id;
    }
   }
   const columns=await captureNativeColumnAdmission(reads,{subjects:[{collection:'employee_profiles',row,lineages:[code],record_id:identities[index]!.id,schema,qualification:{settings_id:String(governing.id),day:clock.day}}],observation:clock});
   if(columns.issues.length)refuse(columnFault(columns.issues[0]!).message);
   const subject={collection:'employee_profiles' as const,id:identities[index]!.id};
   bindNativeAdmissionOwner(reads,subject,{...row,...(nestedPerson?{employee_id:identities[index]!.employee_id}:{} )});
   if(inputAccess===undefined)refuse('Employment family creation requires its actual native authority.');
   await enforceOriginalInputWrites(inputSchemaForScope(governing.employee_input_schema,'employment_terms'),undefined,row.facts,inputAccess);
   const capture = await admitRuntimeInput(proofReads,{field:'employee_input_schema',scope:'employment_terms',code,governing,values:row.facts,context:{observedDay:clock.day,subjectId:identities[index]!.id},subject:{collection:'employee_profiles',id:identities[index]!.id},observation:clock,candidates:Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(row.input_proofs ?? []),files:Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(row.input_files ?? [])});
   acceptNativeAdmissionOwner(reads,subject,capture);
   const custody=await captureInitialNativeInputFamilies({schema,pin:capture.input_schema_snapshot,facts:capture.facts,subject:{collection:'employee_profiles',id:identities[index]!.id},observedAt:clock.observedAt});
   const legalDay=governed(row.effective_range)!.to??clock.day,documentarySetting=settingsInForce(versions,code,legalDay);if(documentarySetting==null)refuse('Employment lifecycle requires its actual sealed law on the declared service day.');
   const lifecycleColumns=await captureNativeColumnAdmission(reads,{subjects:[{collection:'employee_profiles',row,lineages:[code],record_id:identities[index]!.id}],observation:clock,governing_ids:[String(documentarySetting.id)],day:legalDay});
   if(lifecycleColumns.issues.length)refuse(columnFault(lifecycleColumns.issues[0]!).message);
   const documentary=await captureNativeProfileLifecycle(reads,{row:{...row,...capture,...custody,id:identities[index]!.id,employee_id:nestedPerson?identities[index]!.employee_id:row.employee_id},observation:clock,setting:{...documentarySetting}});
   const candidate={...row,...capture,...custody,...documentary,id:identities[index]!.id,employee_id:nestedPerson?identities[index]!.employee_id:row.employee_id};
   const start=await captureNativeProfileStart(reads,{profile_id:identities[index]!.id,candidate,setting:{...governing},observation:clock});
   const blocker=start.issues.find(issue=>issue.severity==='BLOCKER');if(blocker)refuse(blocker.message);
   const columnHistory=await appendNativeColumnAdmission(undefined,{collection:'employee_profiles',id:identities[index]!.id},[columns,lifecycleColumns],clock);
   return { ...inputs[index]!,...capture,...custody,...documentary,...columnHistory, input_census: Schema.decodeUnknownSync(Schema.Json)(custody.input_census), input_originals: Schema.decodeUnknownSync(Schema.Json)(custody.input_originals), input_column_history: Schema.decodeUnknownSync(Schema.Json)(columnHistory.input_column_history) };
  }));
}

c.project((row, ctx) => projectNativeInputs('employee_profiles', row, ctx));


c.action('change_terms',async(input,ctx)=>{
 const request=structuredClone(plain(input));
 const start=String(request.starts_on);
 if(!isCalendarDate(start))ctx.refuse('The successor requires its actual calendar start.');
 const endDate=new Date(`${start}T00:00:00Z`);endDate.setUTCDate(endDate.getUTCDate()-1);const closes=endDate.toISOString().slice(0,10);
 if(request.closes_on!=null&&request.closes_on!==closes)ctx.refuse('The successor must start the day after its predecessor closes.');
 const profiles=await readAll<{id:Id<'employee_profiles'>;facts:unknown}>(ctx,'employee_profiles',{id:{eq:String(request.profile_id)},approval_id:{isNull:true}},undefined,{id:true,facts:true});
 if(profiles.length!==1)ctx.refuse('Change terms requires one actual approved caller-readable profile.');
 const profile=profiles[0]!,facts=profile.facts;
 if(!Predicate.isObject(facts)||!Array.isArray(Reflect.get(facts,'contract_terms')))refuse('Change terms requires the actual complete caller-readable contract bank.');
 const terms=structuredClone(Reflect.get(facts,'contract_terms')) as Record<string,unknown>[];
 const matches=terms.filter(term=>term.id===request.previous_id);
 if(matches.length!==1)ctx.refuse('Change terms requires one actual predecessor source identity.');
 const previous=matches[0]!,period=governed(previous.effective_range);
 if(period==null||start<=period.from)refuse('The successor starts after its predecessor begins.');
 if(!Predicate.isObject(request.facts))refuse('The successor requires its actual declared contract fields.');
 for(const key of ['id','employment_id','effective_range'])if(Object.hasOwn(request.facts,key))refuse('Successor identity, owner and paired period are assigned by the native action.');
 previous.effective_range={from:period.from,to:closes};
 terms.push({...request.facts,id:crypto.randomUUID(),employment_id:profile.id,effective_range:{from:start,to:null}});
 return Schema.decodeUnknownSync(Schema.Json)(plain(await ctx.act('employee_profiles.update',{target:profile.id,set:{facts:Schema.decodeUnknownSync(Schema.Json)({...facts,contract_terms:terms}),...(request.input_proofs==null?{}:{input_proofs:request.input_proofs}),...(request.input_files==null?{}:{input_files:request.input_files})}})));
});
