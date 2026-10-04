import rule_sets from '../rule_sets/+collection.js';
import {validateRuleSetDraft,ruleSetContentHash} from '../../../lib/payroll_engine/execution/rule-sets.js';
import { Schema } from 'effect';
import leave_catalogue from '../leave_catalogue/+collection.js';
import claim_catalogue from '../claim_catalogue/+collection.js';
import adhoc_catalogue from '../adhoc_catalogue/+collection.js';
import allowance_catalogue from '../allowance_catalogue/+collection.js';
import loan_catalogue from '../loan_catalogue/+collection.js';
import statutory_contributions from '../statutory_contributions/+collection.js';
import work_catalogue from '../work_catalogue/+collection.js';
import { validateCatalogueDraft } from '../../../lib/payroll_engine/catalogues/authoring.js';
import { validateStaticDefinition, resolveWorkCaptureRecipe, type StaticDefinition } from '../../../lib/payroll_engine/catalogues/static.js';
import { collection, type Insert } from '@norbital-ai/bolt';
import model from '../../model/jurisdiction_settings/+model.js';
import { plain, stableJson, decodeNumber } from '../../../lib/payroll_engine/foundation/primitives.js';
import { readAll } from '../../../lib/payroll_engine/foundation/reads.js';
import { governed, periodsOverlap } from '../../../lib/payroll_engine/admission/schema-version.js';
import { behavioursFault, resolveBehaviourProgram } from '../../../lib/payroll_engine/execution/behaviours.js';
import { configuredProgramFault } from '../../../lib/payroll_engine/execution/configured-program.js';
import { inputSchemaRootFault, inputValueFault } from '../../../lib/payroll_engine/datatypes/input-schema.js';
import { isOffsetIsoInstant } from '../../../lib/payroll_engine/foundation/time.js';
import {admitReferenceAuthoring,admitReferenceExpression} from '../../../lib/payroll_engine/catalogues/admission.js';
import {factValueFault,factKeySchema} from '../../../lib/payroll_engine/datatypes/fact-keys.js';
import {policyAdmissionFault} from '../../../lib/payroll_engine/catalogues/admission.js';
import * as Predicate from 'effect/Predicate';

type Row = Record<string, unknown>;
const object = (value: unknown): Row => Predicate.isObject(value) ? value as Row : {};
const columns = Object.keys(model.fields).filter(key=>key!=='accepted_input_schemas') as (keyof typeof model.fields)[];
const c = collection('jurisdiction_settings', {
 read: { fields: 'all' }, create: { input: { columns: [...columns, 'cloned_from_id'], with: { rule_sets: { create: { columns: rule_sets.spec.create.input.columns.filter((column): column is Exclude<typeof rule_sets.spec.create.input.columns[number], 'settings_id'> => column !== 'settings_id') } }, leave_catalogue: { create: { columns: leave_catalogue.spec.create.input.columns.filter((column): column is Exclude<typeof leave_catalogue.spec.create.input.columns[number], 'settings_id'> => column !== 'settings_id') } }, claim_catalogue: { create: { columns: claim_catalogue.spec.create.input.columns.filter((column): column is Exclude<typeof claim_catalogue.spec.create.input.columns[number], 'settings_id'> => column !== 'settings_id') } }, adhoc_catalogue: { create: { columns: adhoc_catalogue.spec.create.input.columns.filter((column): column is Exclude<typeof adhoc_catalogue.spec.create.input.columns[number], 'settings_id'> => column !== 'settings_id') } }, allowance_catalogue: { create: { columns: allowance_catalogue.spec.create.input.columns.filter((column): column is Exclude<typeof allowance_catalogue.spec.create.input.columns[number], 'settings_id'> => column !== 'settings_id') } }, loan_catalogue: { create: { columns: loan_catalogue.spec.create.input.columns.filter((column): column is Exclude<typeof loan_catalogue.spec.create.input.columns[number], 'settings_id'> => column !== 'settings_id') } }, statutory_contributions: { create: { columns: statutory_contributions.spec.create.input.columns.filter((column): column is Exclude<typeof statutory_contributions.spec.create.input.columns[number], 'settings_id'> => column !== 'settings_id') } }, work_catalogue: { create: { columns: work_catalogue.spec.create.input.columns.filter((column): column is Exclude<typeof work_catalogue.spec.create.input.columns[number], 'settings_id'> => column !== 'settings_id') } }} } }, update: { input: { columns } }, delete: { transform: true }, actions: { new_settings_version: { description: 'Clone an actual approved jurisdiction and its configured catalogues into one native draft.', input: { settings_id: { kind: 'id', of: 'jurisdiction_settings' }, starts_on: { kind: 'date' }, name: { kind: 'text', optional: true } }, output: { kind: 'json' } } }
});
export default c;

/** One native authoring boundary for drafts and their immutable seals. */
c.transform(async (inputs, ctx) => {
 const outputs = inputs.map(value=>object(plain(value)));
 const previous = ctx.existing.map(value => value == null ? undefined : object(plain(value)));
 const rows = inputs.map((value,index) => ({ ...previous[index], ...object(plain(value)) }));
 for(const [index,row] of rows.entries()) {
  if(object(plain(inputs[index])).$delete===true)continue;
  const recipient=object(object(row.payroll).income_return).recipient_source;
  if(recipient!=null){const fault=policyAdmissionFault('annual_recipient_source',{policy:recipient,kinds:row.history_kinds??[]});if(fault!=null)ctx.refuse(fault);}
  for(const field of ['payroll','history_kinds','overlays','statutory_calendar'])if(Object.hasOwn(row,field)) {
   const fault=policyAdmissionFault(field,row[field]);if(fault!=null)ctx.refuse(`${field}: ${fault}`);
   if(field==="history_kinds"){const fault=policyAdmissionFault("history_restatement",row[field]);if(fault!=null)ctx.refuse(`history_kinds: ${fault}`);}
  }
 }
 const lineage = await readAll<Row>(ctx.db, 'jurisdiction_settings', { code: { in: [...new Set(rows.map(row=>String(row.code)))] } });
 for (let index=0; index<inputs.length; index++) {
  const input = object(plain(inputs[index])), stored = previous[index], row = rows[index]!;
  const deleting = input.$delete === true;
  if (deleting) { if (stored?.sealed_at != null) ctx.refuse('A sealed jurisdiction version cannot be deleted.'); continue; }
  if (stored?.sealed_at != null) {
   const oldRange=governed(stored.effective_range), nextRange=governed(row.effective_range);
   for (const [key,value] of Object.entries(input)) {
    if (['voided_at','void_reason'].includes(key) || stableJson(value) === stableJson(stored[key])) continue;
    if (key === 'effective_range' && oldRange != null && nextRange != null && oldRange.from === nextRange.from && nextRange.to != null && (oldRange.to == null || nextRange.to <= oldRange.to)) continue;
    ctx.refuse('A sealed jurisdiction version is immutable; only its end may shorten or its seal may be voided.');
   }
   if (stored.voided_at != null && (row.voided_at !== stored.voided_at || row.void_reason !== stored.void_reason)) ctx.refuse('A jurisdiction void and its reason are permanent.');
  } else {
   if (row.voided_at != null) ctx.refuse('Only a sealed jurisdiction version can be voided.');
   const referenceFault=admitReferenceAuthoring(row);if(referenceFault!=null)ctx.refuse(referenceFault);
   const declarations=Array.isArray(row.tables)?row.tables.map(object):[];
   const referenceRows=Array.isArray(row.reference_rows)?row.reference_rows.map(object):[];
   const inspect=(value:unknown,path:string)=>{
    if(Array.isArray(value)){for(const child of value)inspect(child,path);return;}
    if(!Predicate.isObjectOrArray(value))return;
    const node=object(value),meta=object(node['x-norbital']);
    const declaration=meta.fact??(Predicate.isString(node.key)&&['boolean','number','string','date','instant','code'].includes(String(node.type))?node:undefined);
    if(declaration!=null){const fact=Schema.decodeUnknownSync(factKeySchema)(declaration);
     if(fact.type==='code'&&!declarations.some(table=>table.name===fact.table))ctx.refuse(`${fact.key} names table ${String(fact.table)}, which this settings version does not declare.`);
     if(fact.evidence?.document!=null&&!referenceRows.some(record=>record.table==='DOCUMENT_TYPE'&&record.code===fact.evidence!.document))ctx.refuse(`${fact.key} names document ${fact.evidence.document}, which is not a DOCUMENT_TYPE row.`);
     if(fact.default_value!=null&&fact.type==='code'){
      const fault=factValueFault(fact,fact.default_value,(table,code)=>{const found=referenceRows.find(record=>record.table===table&&record.code===code&&governed(record.effective_range)!=null&&governed(record.effective_range)!.from<=String(object(row.effective_range).from)&&(governed(record.effective_range)!.to==null||String(object(row.effective_range).from)<=governed(record.effective_range)!.to!));return found==null?null:{parent_code:Predicate.isString(found.parent_code)?found.parent_code:null};});if(fault!=null)ctx.refuse(`${fault} when this version begins.`);
     }
    }
    for(const [key,child] of Object.entries(node)){
     if(Predicate.isString(child)&&['expression','when','require','emit','due','employee','employer'].includes(key)){const fault=admitReferenceExpression(declarations,child);if(fault)ctx.refuse(`${path}/${key}: ${fault}`);}
     else if(Predicate.isObjectOrArray(child))inspect(child,path+'/'+key);
    }
   };
   inspect(row,'jurisdiction');
   for (const field of ['employee_input_schema','entity_input_schema']) {
    if (row[field] == null) continue;
    const fault=inputSchemaRootFault(row[field]); if (fault != null) ctx.refuse(`${field}: ${fault}`);
    if (object(row[field]).type !== 'object') ctx.refuse(`${field} requires a closed root object.`);
   }
   const finite=inputValueFault({},row.behaviours); if(finite != null) ctx.refuse(finite);
   const fault=behavioursFault(row.behaviours); if(fault != null) ctx.refuse(fault);
   for (const [hash,program] of Object.entries(object(object(row.behaviours).programs))) {
    const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJson(program)))),byte=>byte.toString(16).padStart(2,'0')).join('');
    if(actual !== hash) ctx.refuse('Configured programmes retain their exact content-addressed SHA-256 identity.');
   }
   for (const family of ['leave_catalogue','claim_catalogue','adhoc_catalogue','allowance_catalogue','loan_catalogue','statutory_contributions'] as const) {
    const nested=Array.isArray(input[family]) ? input[family] as unknown[] : [];
    const persisted=row.id==null?[]:await readAll<Row>(ctx.db,family,{settings_id:{eq:String(row.id)}});
    for(const child of [...persisted,...nested.map(object)]) await validateCatalogueDraft(family,child,{...row,sealed_at:null,voided_at:null});
   }
   const nestedRules=Array.isArray(input.rule_sets)?input.rule_sets.map(object):[];
   const savedRules=row.id==null?[]:await readAll<Row>(ctx.db,'rule_sets',{settings_id:{eq:String(row.id)}});
   const identities=new Set<string>(),ordinals=new Set<number>();
   for(const child of [...savedRules,...nestedRules]){
    await validateRuleSetDraft(child,{...row,sealed_at:stored?.sealed_at??null,voided_at:stored?.voided_at??null},ctx.db);
    const identity=stableJson([child.family,child.code]);if(identities.has(identity))ctx.refuse('A jurisdiction draft retains unique rule group identities.');identities.add(identity);
    for(const entry of object(child.rules).entries as Row[]){const ordinal=decodeNumber(entry.global_ordinal);if(ordinals.has(ordinal))ctx.refuse('Rule groups preserve distinct original global ordinals.');ordinals.add(ordinal);}
   }
   if(nestedRules.length)outputs[index]={...outputs[index],rule_sets:await Promise.all(nestedRules.map(async child=>({...child,content_hash:await ruleSetContentHash(child)})))};
   if(row.sealed_at!=null&&!identities.has(stableJson(['WORK','WORK'])))ctx.refuse('A jurisdiction seal requires its authoritative WORK rule group.');
   const workChildren=Array.isArray(input.work_catalogue)?input.work_catalogue as unknown[]:[];
   const savedWork=row.id==null?[]:await readAll<Row>(ctx.db,'work_catalogue',{settings_id:{eq:String(row.id)}});
   const workRules=[...savedRules,...nestedRules].filter(child=>child.family==='WORK'&&child.code==='WORK');
   if([...savedWork,...workChildren].length&&workRules.length!==1)ctx.refuse('WORK recipes require exactly one actual draft regulatory group.');
   for(const child of [...savedWork,...workChildren.map(object)])validateStaticDefinition(await resolveWorkCaptureRecipe(child as StaticDefinition,object(workRules[0]?.rules).data));
   const clearance=object(object(row.payroll).clearance_source_refs);
   if(Object.keys(clearance).length){
    if(Object.keys(clearance).sort().join(',')!=='families_program_ref,financial_program_ref')ctx.refuse('Clearance programmes require both exact immutable source references.');
    for(const ref of Object.values(clearance)){if(!Predicate.isString(ref)||!/^[a-f0-9]{64}$/.test(ref))ctx.refuse('Clearance programme references require lowercase SHA-256 identities.');await resolveBehaviourProgram(row.behaviours,String(ref),ctx.db);}
   }
   const payroll=object(row.payroll), cases=Array.isArray(payroll.benefit_cases)?payroll.benefit_cases.map(object):[], programs=object(payroll.certified_assessment_programs);
   const types=cases.filter(type=>type.basis === 'CERTIFIED_INTERVALS');
   if(new Set(types.map(type=>type.case_type)).size !== types.length || Object.keys(programs).some(key=>!types.some(type=>type.case_type===key))) ctx.refuse('Certified programmes bind unique actual governing certified benefit case types.');
   for(const type of types) {
    const frame=object(programs[String(type.case_type)]);
    if(stableJson(frame.type)!==stableJson(type))ctx.refuse('Certified programme metadata must match its exact governing case type and basis.');
    for(const key of ['admission','earning','qualification','pricing','absence','frozen','paid_leave','dates','disease','totals','source_capture']) {
     const fault=configuredProgramFault(frame[key]);if(fault != null)ctx.refuse(`Certified ${String(type.case_type)} ${key}: ${fault}`);
    }
   }
   if(!Predicate.isString(payroll.currency) || !payroll.currency.trim() || !Predicate.isString(row.jurisdiction_code) || !row.jurisdiction_code.trim())ctx.refuse('A jurisdiction requires its currency and stable jurisdiction code.');
  }
  const range=governed(row.effective_range);if(range==null)ctx.refuse('A jurisdiction requires a valid inclusive native effective range.');
  if(row.sealed_at!=null && !isOffsetIsoInstant(row.sealed_at))ctx.refuse('A jurisdiction seal requires an actual offset timestamp.');
  if(row.voided_at!=null) {
   if(!isOffsetIsoInstant(row.voided_at))ctx.refuse('Voiding a sealed jurisdiction retains its actual dated timestamp.');
   if(stored?.voided_at == null) {
    const paid=await readAll<Row>(ctx.db,'payslips',{status:{eq:'PAID'},payroll_run_id:{is:{settings_id:{eq:String(row.id)}}}},undefined,{id:true},1);
    if(paid.length && (!Predicate.isString(row.void_reason)||!row.void_reason.trim()))ctx.refuse('Voiding a jurisdiction that priced paid payroll requires its retained reason.');
   }
  }
  if(row.sealed_at!=null&&row.voided_at==null) {
   const candidates=[...lineage.filter(other=>other.id!==row.id&&!rows.some(candidate=>candidate.id===other.id)),...rows.filter(other=>other!==row)];
   if(candidates.some(other=>other.code===row.code&&other.sealed_at!=null&&other.voided_at==null&&governed(other.effective_range)!=null&&periodsOverlap(range!,governed(other.effective_range)!)))ctx.refuse('Live sealed versions of one jurisdiction lineage cannot overlap.');
  }
 }
 return outputs as typeof inputs;
});

c.action('new_settings_version', async (input,ctx) => {
 const originals=await readAll<Row>(ctx,'jurisdiction_settings',{id:{eq:String(input.settings_id)},approval_id:{isNull:true}});
 if(originals.length!==1)ctx.refuse('A jurisdiction clone requires one actual approved source version.');
 const source=originals[0]!;
 const range=governed(source.effective_range);
 if(range==null||!Schema.is(Schema.String)(input.starts_on)||inputValueFault({type:'string',format:'date'},input.starts_on)!=null||String(input.starts_on)<=range.from)ctx.refuse('A successor starts after its original version begins.');
 const draft:Row=Object.fromEntries(columns.filter(key=>!['sealed_at','voided_at','void_reason'].includes(key)).map(key=>[key,source[key]]));
 draft.cloned_from_id=source.id;draft.name=input.name??`${String(source.code)} from ${String(input.starts_on)}`;draft.sealed_at=null;draft.voided_at=null;draft.void_reason=null;draft.effective_range={from:String(input.starts_on),to:object(source.effective_range).to??null};
 const families={rule_sets,leave_catalogue,claim_catalogue,adhoc_catalogue,allowance_catalogue,loan_catalogue,statutory_contributions,work_catalogue};
 for(const family of ['rule_sets','leave_catalogue','claim_catalogue','adhoc_catalogue','allowance_catalogue','loan_catalogue','statutory_contributions','work_catalogue'] as const) {
  const definition=families[family];
  const children=await readAll<Row>(ctx,family,{settings_id:{eq:String(source.id)},approval_id:{isNull:true}});
  draft[family]=children.map(child=>Object.fromEntries(definition.spec.create.input.columns.filter(key=>key!=='settings_id').map(key=>[key,child[key]])));
 }
 return Schema.decodeUnknownSync(Schema.Json)(plain(await ctx.act('jurisdiction_settings.create',draft as Insert<'jurisdiction_settings'>)));
});
