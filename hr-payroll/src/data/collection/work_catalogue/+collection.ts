import { Schema } from 'effect';
import { collection } from '@norbital-ai/bolt';
import { plain } from '../../../lib/payroll_engine/foundation/primitives.js';
import { readAll } from '../../../lib/payroll_engine/foundation/reads.js';
import { validateRuleSetDraft } from '../../../lib/payroll_engine/execution/rule-sets.js';
import { refuse } from '../../../lib/payroll_engine/foundation/primitives.js';
import { versionsById, refuseUnlessDraftOnBoth } from '../../../lib/payroll_engine/catalogues/settings-seal.js';
import { validateStaticDefinition, resolveWorkCaptureRecipe, priceNativeStatic, type StaticDefinition } from '../../../lib/payroll_engine/catalogues/static.js';
import * as Predicate from 'effect/Predicate';

const columns = ['code','name','original_id','original_order','output','component_code','mode','phase','source_policy','cash_rounding','program','measurement','measurement_output','eligibility','quantity','rate','amount','destination','direction'] as const;
const c = collection('work_catalogue', {
 read: { fields: 'all' },
 queries: { price: { description: 'Price original configured static work from caller-readable native employee and entity inputs, without accepting caller amounts.', input: { profile_id: { kind: 'id', of: 'employee_profiles' }, day: { kind: 'date' }, run_id: { kind: 'id', of: 'payroll_runs', optional: true } }, output: { kind: 'json' } } },
 create: { input: { columns: ['settings_id', ...columns] } },
 update: { input: { columns } }
});
export default c;
c.transform(async (inputs, ctx) => {
 const rows = inputs.map(input => plain(input));
 const stored = ctx.existing.map(row => row == null ? undefined : plain(row));
 const versions = await versionsById(ctx.db, [...rows.map(row => row.settings_id), ...stored.map(row => row?.settings_id)]);
 for(const [index,row] of rows.entries()) {
  const next={...stored[index],...row};
  refuseUnlessDraftOnBoth(versions,stored[index]?.settings_id,next.settings_id,'Work catalogue');
  if(!Predicate.isString(next.settings_id)||!next.settings_id)refuse('WORK authoring requires its actual native draft owner and qualified shared recipe.');
  const parents=await readAll<Record<string,unknown>>(ctx.db,'jurisdiction_settings',{id:{eq:next.settings_id}});
  if(parents.length!==1)refuse('WORK authoring requires one actual jurisdiction draft.');
  const rules=await readAll<Record<string,unknown>>(ctx.db,'rule_sets',{settings_id:{eq:next.settings_id},family:{eq:'WORK'},code:{eq:'WORK'}});
  if(rules.length!==1||rules[0]?.approval_id!=null)refuse('WORK authoring requires one actual approved native WORK capture rule group.');
  await validateRuleSetDraft(rules[0]!,parents[0]!);
  const data=Schema.decodeUnknownSync(Schema.Struct({data:Schema.Unknown}))(rules[0]!.rules).data;
  validateStaticDefinition(await resolveWorkCaptureRecipe(next as StaticDefinition,data));
 }
 return inputs;
});


c.query('price', async (input, ctx) => Schema.decodeUnknownSync(Schema.Json)(await priceNativeStatic(ctx, { catalog: 'WORK', profile_id: String(input.profile_id), day: String(input.day), ...(input.run_id == null ? {} : { run_id: String(input.run_id) }), observation: { observedAt: String(ctx.now), timezone: ctx.tz } })));
