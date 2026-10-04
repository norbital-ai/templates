import {normalizeInputCandidate} from '../../../lib/payroll_engine/datatypes/input-schema.js';
import {appendNativeColumnAdmission,captureNativeColumnAdmission} from '../../../lib/payroll_engine/admission/input-column-admission.js';
import { projectNativeInputs, enforceOriginalInputWrites, type InputWriteAccess } from '../../../lib/payroll_engine/admission/input-access.js';
import { collection } from '@norbital-ai/bolt';
import { plain } from '../../../lib/payroll_engine/foundation/primitives.js';
import { admitNativeInputUpdates, admitRuntimeInput, resolveInputSchema } from '../../../lib/payroll_engine/admission/input-schema-admission.js';
import * as Predicate from 'effect/Predicate';

import { refuse } from '../../../lib/payroll_engine/foundation/primitives.js';
import { PlainDate } from '@norbital-ai/std/date';
import { isOffsetIsoInstant, calendarDateInTimeZone } from '../../../lib/payroll_engine/foundation/time.js';
import { coversDay, settingsInForce } from '../../../lib/payroll_engine/admission/schema-version.js';
import { runtimeProofReads } from '../../../lib/payroll_engine/admission/runtime-proof.js';
import { Schema } from 'effect';
import { inputSchemaForScope, type InputSchema } from '../../../lib/payroll_engine/datatypes/input-schema.js';
import { admitProfileCreates } from '../employee_profiles/+collection.js';
import {initialNativeInputFamilies,captureInitialNativeInputFamilies} from '../../../lib/payroll_engine/admission/facts.js';
import {createNativeAdmissionGraph,bindNativeAdmissionOwner,acceptNativeAdmissionOwner} from '../../../lib/payroll_engine/admission/owner-graph.js';
import { readAll, type Reads } from '../../../lib/payroll_engine/foundation/reads.js';

/** The first column admission issue's actual native message. */
const columnFault = Schema.decodeUnknownSync(Schema.Struct({ message: Schema.String }));

const biometricColumns = ['face_embedding', 'face_photo', 'face_enrollment_status', 'face_consent_at', 'face_enrolled_at', 'face_last_match_at', 'face_match_count'] as const;
const personColumns=['date_of_birth','gender','marital_status','solo_parent','disabled','receiving_pension','race','religion','spouse_status','children','nationality','identity_number','dependents_count','address','location'] as const;
const c = collection('employees', {
 read: { fields: 'all', projection: { fields: ['facts','input_originals','input_history','input_proofs','input_files','input_census','input_column_history'], context: ['input_schema_snapshot', 'input_originals', 'facts', 'input_proofs', 'input_files'] } },
 create: { input: { columns: ['name', 'input_schema_code', 'facts', 'input_proofs', 'input_files', 'email', 'phone',...personColumns, ...biometricColumns], with: { employee_profiles: { create: { columns: ['company_id', 'employee_number', 'effective_range', 'facts', 'input_proofs', 'input_files'] } } } } },
 update: { input: { columns: ['name', 'date_of_birth', 'gender', 'marital_status', 'solo_parent', 'race', 'religion', 'spouse_status', 'children', 'nationality', 'identity_number', 'dependents_count', 'disabled', 'receiving_pension', 'email', 'phone', 'address', 'location', 'user_id', 'face_embedding', 'face_photo', 'face_enrollment_status', 'face_consent_at', 'face_enrolled_at', 'face_last_match_at', 'face_match_count', 'facts', 'input_proofs', 'input_files'] } },
 similarity: { face: { description: 'Match an admitted face descriptor against approved employee embeddings.', input: { probe: { kind: 'list', of: { kind: 'number' } } }, candidates: 1 } },
 queries: { kiosk_input_schema: { description: 'Resolve the governing server-local person fact schema for kiosk enrollment.', input: { company_id: { kind: 'id', of: 'entities' } }, output: { kind: 'json' } }, kiosk_match: { description: 'Match a kiosk face probe against one approved entity\u2019s employees.', input: {
  company_id: { kind: 'id', of: 'entities' }, probe: { kind: 'list', of: { kind: 'number' } },
  threshold: { kind: 'number', min: 0, max: 0.25, optional: true }
 }, output: { kind: 'json' } } },
 actions: {
  kiosk_enroll: { description: 'Admit a kiosk face enrollment for an employee or new named person.', input: {
   employee_id: { kind: 'id', of: 'employees', optional: true },
   new_person: { kind: 'object', optional: true, fields: {
    name: { kind: 'text' }, email: { kind: 'text', optional: true }, phone: { kind: 'text', optional: true },
    company_id: { kind: 'id', of: 'entities' }, employee_number: { kind: 'text', optional: true },
    person_facts: { kind: 'text' }, profile_facts: { kind: 'text' },
    person_proofs: { kind: 'text', optional: true }, profile_proofs: { kind: 'text', optional: true }, person_files: { kind: 'text', optional: true }, profile_files: { kind: 'text', optional: true }
   } },
   face_embedding: { kind: 'list', of: { kind: 'number' } },
   face_photo: { kind: 'file', accept: ['image/jpeg', 'image/png'], max: '5MiB', optional: true },
   consent_at: { kind: 'instant' }
  }, output: { kind: 'json' } },
  kiosk_receipt: { description: 'Record an attended face or manual kiosk receipt.', input: { id: { kind: 'id', of: 'employees' }, kind: { kind: 'enum', values: ['FACE', 'MANUAL'] } }, output: { kind: 'json' } }
 }
});
export default c;
c.transform(async (inputs, ctx) => {
 const existing = structuredClone(ctx.existing);
 if (existing.every(row => row == null) && inputs.length) {
  const result = [];
  const roots=ctx.staged.filter(row=>row.collection==='employees'&&row.parent==null);
  if(roots.length!==inputs.length)refuse('Employee creation requires its actual engine-assigned batch identities.');
  const admissionReads=createNativeAdmissionGraph(ctx.db,ctx.staged);
  for (const [inputIndex,value] of inputs.entries()) {
   const input = plain(value), code = String(input.input_schema_code ?? '');
   if (!code.trim() || !String(input.name ?? '').trim()) refuse('Employee creation requires a name and its actual jurisdiction lineage.');
   const versions = await readAll<NonNullable<Parameters<typeof admitRuntimeInput>[1]['governing']> & { employee_input_schema: InputSchema; effective_range: unknown; voided_at?: unknown; payroll: { timezone: string } }>(ctx.db, 'jurisdiction_settings', { code: { eq: code }, approval_id: { isNull: true }, sealed_at: { isNull: false, lte: String(ctx.now) }, voided_at: { isNull: true } });
   const candidates = versions.filter(version => Predicate.isString(version.payroll?.timezone) && settingsInForce(versions, code, calendarDateInTimeZone(new Date(String(ctx.now)), version.payroll.timezone))?.id === version.id);
   if (candidates.length !== 1) refuse('Employee creation requires exactly one actual server-local sealed governing jurisdiction.');
   const governing = candidates[0]!, timezone = governing.payroll.timezone, observedDay = calendarDateInTimeZone(new Date(String(ctx.now)), timezone);
   const schema=inputSchemaForScope(governing.employee_input_schema,'person_facts');
   Object.assign(input,{facts:normalizeInputCandidate(schema,initialNativeInputFamilies(schema,input.facts))});
   const admittedColumns=await admitPersonColumns(ctx.db,{...input,id:roots[inputIndex]!.id},undefined,{observedAt:String(ctx.now),timezone},schema,{settings_id:String(governing.id),day:observedDay});
   const columnReceipt=await appendNativeColumnAdmission(undefined,{collection:'employees',id:roots[inputIndex]!.id},[admittedColumns],{observedAt:String(ctx.now),timezone});
   const subject={collection:'employees' as const,id:roots[inputIndex]!.id};
   bindNativeAdmissionOwner(admissionReads,subject,input);
   const files = Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(input.input_files ?? []);
   const proofs = await runtimeProofReads(admissionReads, [{ collection: 'employees', files }]);
   await enforceOriginalInputWrites(inputSchemaForScope(governing.employee_input_schema,'person_facts'),undefined,input.facts,{actor:ctx.actor,policies:ctx.policies,admin:ctx.admin,get:ctx.db.get as InputWriteAccess['get']});
   const capture = await admitRuntimeInput(proofs, { field: 'employee_input_schema', scope: 'person_facts', code, governing, values: input.facts, context: { observedDay,subjectId:roots[inputIndex]!.id }, subject: { collection: 'employees',id:roots[inputIndex]!.id }, observation: { observedAt: String(ctx.now), timezone }, candidates: Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(input.input_proofs ?? []), files });
   acceptNativeAdmissionOwner(admissionReads,subject,capture);
   if (input.face_embedding != null) descriptor(input.face_embedding as readonly number[]);
   let profiles;
   if (value.employee_profiles != null) {
    const nested = value.employee_profiles;
    if (!Predicate.isObject(nested) || Object.keys(nested).length !== 1 || !Object.hasOwn(nested, 'create')) refuse('Employee creation admits only native nested employment creation.');
    const children = nested.create;
    if (children == null || children.some(child => !Predicate.isObject(child) || Object.hasOwn(child, 'employee_id'))) refuse('Nested employment ownership is assigned only by the actual native parent.');
    const identities=ctx.staged.filter(row=>row.collection==='employee_profiles'&&row.parent?.collection==='employees'&&row.parent.id===roots[inputIndex]!.id&&row.parent.relation==='employee_profiles'&&row.operation==='create');
    if(identities.length!==children.length)refuse('Nested profiles require their actual native parent and assigned child paths.');
    profiles = { create: await admitProfileCreates(children, admissionReads, { observedAt: String(ctx.now), timezone, day: observedDay }, true, {actor:ctx.actor,policies:ctx.policies,admin:ctx.admin,get:ctx.db.get as InputWriteAccess['get']},identities.map(row=>({id:row.id,employee_id:roots[inputIndex]!.id}))) };
   }
   const custody=await captureInitialNativeInputFamilies({schema,pin:capture.input_schema_snapshot,facts:capture.facts,subject:{collection:'employees',id:roots[inputIndex]!.id},observedAt:String(ctx.now)});
   result.push({ ...value, ...capture, ...custody, input_census: Schema.decodeUnknownSync(Schema.Json)(custody.input_census), input_originals: Schema.decodeUnknownSync(Schema.Json)(custody.input_originals), input_column_history: Schema.decodeUnknownSync(Schema.Json)(columnReceipt.input_column_history), input_files: input.input_files ?? [], ...(profiles == null ? {} : { employee_profiles: profiles }) });
  }
  return result;
 }
 const result = inputs.map(input => ({...input}));
 const indices = result.flatMap((input, index) => (['facts', 'input_proofs', 'input_files'].some(field => Object.hasOwn(input, field))) ? [index] : []);
 if (indices.length) {
  const captures = await admitNativeInputUpdates(ctx.db, 'employees', indices.map(index => Object.fromEntries(Object.entries(result[index]!).filter(([key]) => ['facts', 'input_proofs', 'input_files'].includes(key)))), indices.map(index => existing[index] == null ? undefined : plain(existing[index])), { observedAt: String(ctx.now), timezone: ctx.tz, day: String(ctx.today) }, {inputAccess:{actor:ctx.actor,policies:ctx.policies,admin:ctx.admin,get:ctx.db.get as InputWriteAccess['get']}});
  for (let at = 0; at < indices.length; at++) {
   const index = indices[at]!;
   const capture = captures[at]!;
   const custody = 'input_census' in capture ? { input_census: Schema.decodeUnknownSync(Schema.Json)(capture.input_census), input_originals: Schema.decodeUnknownSync(Schema.Json)(capture.input_originals) } : {};
   Object.assign(result[index]!, capture, custody, { input_files: inputs[index]!.input_files ?? existing[index]?.input_files ?? [] });
  }
 }
 for(const [index] of result.entries()){const input=plain(result[index]!),previous=plain(existing[index]!);const columns=await admitPersonColumns(ctx.db,{...previous,...input},previous,{observedAt:String(ctx.now),timezone:ctx.tz});Object.assign(result[index]!,await appendNativeColumnAdmission(previous,{collection:'employees',id:String(previous.id)},[columns],{observedAt:String(ctx.now),timezone:ctx.tz}));}
 for (const input of result) if (plain(input).face_embedding != null) descriptor(plain(input).face_embedding as readonly number[]);
 return result;
});

async function admitPersonColumns(reads:Reads,row:Readonly<Record<string,unknown>>,previous:Readonly<Record<string,unknown>>|undefined,observation:{observedAt:string;timezone:string},acceptedSchema?:InputSchema,acceptedQualification?:{settings_id:string;day:string}){
 const profiles=previous==null?[]:await readAll<{id:string;company_id:string}>(reads,'employee_profiles',{employee_id:{eq:String(previous.id)},approval_id:{isNull:true}},undefined,{id:true,company_id:true});
 const nested=row.employee_profiles;
 const creates=Predicate.isObject(nested)?Reflect.get(nested,'create'):undefined;
 const proposed=Array.isArray(creates)?creates.map(value=>Predicate.isObject(value)?Reflect.get(value,'company_id'):undefined):[];
 const ids=[...new Set([...profiles.map(profile=>profile.company_id),...proposed])];
 if(ids.some(id=>!Predicate.isString(id)||!id.trim()))refuse('Person classification retains actual contract employer identities.');
 const companies=ids.length?await readAll<{id:string;settings_code:string;approval_id?:unknown}>(reads,'entities',{id:{in:ids as string[]},approval_id:{isNull:true}},undefined,{id:true,settings_code:true,approval_id:true}):[];
 if(companies.length!==ids.length||new Set(companies.map(company=>company.id)).size!==ids.length||companies.some(company=>!ids.includes(company.id)||company.approval_id!=null))refuse('Person classification requires every actual approved contract employer.');
 const resolved=acceptedSchema!=null||previous==null?undefined:await resolveInputSchema(reads,{field:'employee_input_schema',scope:'person_facts',code:String(previous.input_schema_code),originalPin:previous.input_schema_snapshot});
 const schema=acceptedSchema??resolved?.schema;
 const qualification=acceptedQualification??(resolved==null?undefined:{settings_id:resolved.pin.snapshot_id,day:calendarDateInTimeZone(new Date(observation.observedAt),observation.timezone)});
 const columns=await captureNativeColumnAdmission(reads,{subjects:[{collection:'employees',row,...(previous==null?{}:{previous}),lineages:[...new Set(companies.map(company=>company.settings_code))],...(schema==null?{}:{schema}),...(qualification==null?{}:{qualification})}],observation});
 if(columns.issues.length)refuse(columnFault(columns.issues[0]!).message);
 return columns;
}

function descriptor(probe: readonly number[]) {
 if (probe.length !== 1024 || probe.some(value => !Number.isFinite(value)) || probe.every(value => value === 0)) refuse('A face descriptor requires 1024 finite numbers and a nonzero vector.');
}
c.similarity('face', { probe: ({ probe }) => ({ field: 'face_embedding', vector: probe, where: { face_enrollment_status: { eq: 'APPROVED' }, approval_id: { isNull: true } } }) });
c.query('kiosk_match', async ({ company_id, probe, threshold }, ctx) => {
 descriptor(probe);
 const maximum = threshold ?? 0.25;
 if (!Number.isFinite(maximum) || maximum < 0 || maximum > 0.25) refuse('Face matching requires its original conservative finite threshold.');
 const rows = await ctx.similar('employees', 'face', { probe }, { limit: 2, select: { name: true } });
 const [hit, next] = rows;
 if (hit == null || !Number.isFinite(hit.$distance) || hit.$distance > maximum || (next != null && next.$distance <= maximum + 0.05 && next.$distance - hit.$distance < 0.05)) return { status: 'unknown' };
 const entity = await ctx.get('entities', company_id, { select: { settings_code: true, approval_id: true } });
 if (entity == null || entity.approval_id != null) refuse('The kiosk requires its actual approved entity.');
 const versions = await readAll<{ id: string; code: string; sealed_at: string; effective_range: unknown; voided_at?: unknown; approval_id?: unknown; payroll: { timezone?: string } }>(ctx, 'jurisdiction_settings', { code: { eq: entity.settings_code }, approval_id: { isNull: true }, sealed_at: { isNull: false, lte: String(ctx.now) }, voided_at: { isNull: true } });
 const candidates = versions.filter(version => Predicate.isString(version.payroll?.timezone) && settingsInForce(versions, entity.settings_code, String(ctx.todayIn(version.payroll.timezone)))?.id === version.id);
 if (candidates.length !== 1) refuse('The kiosk requires exactly one jurisdiction governing its actual server-local date.');
 const governing = candidates[0]!, today = String(ctx.todayIn(governing.payroll.timezone!));
 const profiles = await ctx.read('employee_profiles', { where: { employee_id: { eq: hit.id }, company_id: { eq: company_id }, approval_id: { isNull: true } }, select: { employee_number: true, company_id: true, effective_range: true }, all: true });
 const active = profiles.rows.filter(row => coversDay(plain(row.effective_range), today));
 if (active.length > 1) refuse('Resolve overlapping active employee profiles before taking attendance.');
 const employee = { id: hit.id, name: hit.name }, current = active[0];
 if (current == null) return { status: 'unenrolled', employee, distance: hit.$distance };
 return { status: 'match', employee, employment: { id: current.id, employee_number: current.employee_number, company_id: current.company_id }, distance: hit.$distance };
});
c.action('kiosk_enroll', async ({ employee_id, new_person, face_embedding, face_photo, consent_at }, ctx) => {
 descriptor(face_embedding);
 if (!isOffsetIsoInstant(String(consent_at)) || Date.parse(String(consent_at)) > Date.parse(String(ctx.now))) refuse('Consent must be an actual instant no later than enrollment.');
 if (employee_id == null) {
  if (new_person == null || !new_person.name.trim()) refuse('Enrollment requires an employee or a new named person.');
  const entity = await ctx.get('entities', new_person.company_id, { select: { settings_code: true, approval_id: true } });
  if (entity == null || entity.approval_id != null) refuse('Enrollment requires its actual approved employing entity.');
  const configuration = Schema.decodeUnknownSync(Schema.Struct({ observed_day: Schema.NonEmptyString }))(await ctx.query('employees', 'kiosk_input_schema', { company_id: new_person.company_id }));
  const employeeNumber = new_person.employee_number?.trim() || `KIOSK-${crypto.randomUUID()}`;
  const created = await ctx.act('employees.create', {
   name: new_person.name.trim(), input_schema_code: entity.settings_code,
   facts: Schema.decodeUnknownSync(Schema.Json)(JSON.parse(new_person.person_facts)), input_proofs: Schema.decodeUnknownSync(Schema.Json)(JSON.parse(new_person.person_proofs ?? '[]')), input_files: JSON.parse(new_person.person_files ?? '[]'), ...(new_person.email == null ? {} : { email: new_person.email }), ...(new_person.phone == null ? {} : { phone: new_person.phone }),
   face_embedding, ...(face_photo == null ? {} : { face_photo }), face_enrollment_status: 'PENDING', face_consent_at: consent_at, face_enrolled_at: ctx.now,
   employee_profiles: { create: [{ company_id: new_person.company_id, employee_number: employeeNumber, effective_range: { from: PlainDate(configuration.observed_day), to: null }, facts: Schema.decodeUnknownSync(Schema.Json)(JSON.parse(new_person.profile_facts)), input_proofs: Schema.decodeUnknownSync(Schema.Json)(JSON.parse(new_person.profile_proofs ?? '[]')), input_files: JSON.parse(new_person.profile_files ?? '[]') }] }
  });
  const record = created.records.find(row => row.collection === 'employees');
  if (record == null) refuse('Enrollment did not stage its actual employee.');
  return { employee_id: record.id, company_id: new_person.company_id, employee_number: employeeNumber, status: 'PENDING' };
 }
 if (new_person != null) refuse('Pass one employee or one new person.');
 const known = await ctx.get('employees', employee_id, { select: { face_enrollment_status: true, approval_id: true } });
 if (known == null || known.approval_id != null) refuse('Enrollment requires an actual approved employee.');
 if (known.face_enrollment_status === 'PENDING' || known.face_enrollment_status === 'SUSPENDED') refuse('HR must review pending or suspended face enrollment before replacement.');
 await ctx.act('employees.update', { target: employee_id, set: { face_embedding, ...(face_photo == null ? {} : { face_photo }), face_enrollment_status: 'APPROVED', face_consent_at: consent_at, face_enrolled_at: ctx.now } });
 return { employee_id, status: 'APPROVED' };
});
c.action('kiosk_receipt', async ({ id, kind }, ctx) => {
 const employee = await ctx.get('employees', id, { select: { approval_id: true, face_enrollment_status: true, face_last_match_at: true, face_match_count: true } });
 if (employee == null || employee.approval_id != null) refuse('Attendance requires an actual approved employee.');
 const now = Date.parse(String(ctx.now));
 if (!Number.isFinite(now)) refuse('Attendance requires its actual server observation.');
 if (employee.face_last_match_at != null) {
  const previous = Date.parse(String(employee.face_last_match_at));
  if (!Number.isFinite(previous) || now - previous < 10_000) refuse('Wait ten seconds after the last face match before recording another punch.');
 }
 if (kind === 'FACE') {
  if (employee.face_enrollment_status !== 'APPROVED') refuse('Face attendance requires an approved enrollment.');
  if (!Number.isSafeInteger(employee.face_match_count) || employee.face_match_count < 0 || employee.face_match_count === Number.MAX_SAFE_INTEGER) refuse('Retain a valid original face match count.');
  await ctx.act('employees.update', { target: id, set: { face_last_match_at: ctx.now, face_match_count: employee.face_match_count + 1 } });
 }
 return { employee_id: id, kind, observed_at: String(ctx.now) };
});

c.query('kiosk_input_schema', async ({ company_id }, ctx) => {
 const entity = await ctx.get('entities', company_id, { select: { settings_code: true, approval_id: true } });
 if (entity == null || entity.approval_id != null) refuse('Enrollment requires its actual approved entity.');
 const versions = await readAll<{ id: string; code: string; sealed_at: string; effective_range: unknown; voided_at?: unknown; approval_id?: unknown; payroll: { timezone?: string }; employee_input_schema: InputSchema }>(ctx, 'jurisdiction_settings', { code: { eq: entity.settings_code }, approval_id: { isNull: true }, sealed_at: { isNull: false, lte: String(ctx.now) }, voided_at: { isNull: true } });
 const candidates = versions.filter(version => Predicate.isString(version.payroll?.timezone) && settingsInForce(versions, entity.settings_code, String(ctx.todayIn(version.payroll.timezone)))?.id === version.id);
 if (candidates.length !== 1) refuse('Enrollment requires exactly one snapshot governing its actual server-local date.');
 const governing = candidates[0]!, day = String(ctx.todayIn(governing.payroll.timezone!));
 return Schema.decodeUnknownSync(Schema.Json)({ person_facts: inputSchemaForScope(governing.employee_input_schema, 'person_facts'), employment_terms: inputSchemaForScope(governing.employee_input_schema, 'employment_terms'), snapshot_id: governing.id, observed_day: day });
});

c.project((row, ctx) => projectNativeInputs('employees', row, ctx));
