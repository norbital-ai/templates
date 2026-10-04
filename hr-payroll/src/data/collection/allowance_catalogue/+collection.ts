import { collection } from '@norbital-ai/bolt';
import { plain } from '../../../lib/payroll_engine/foundation/primitives.js';
import { versionsById, refuseUnlessDraftOnBoth } from '../../../lib/payroll_engine/catalogues/settings-seal.js';
import { readAll } from '../../../lib/payroll_engine/foundation/reads.js';
import { validateCatalogueDraft } from '../../../lib/payroll_engine/catalogues/authoring.js';
import { refuse } from '../../../lib/payroll_engine/foundation/primitives.js';
import { Schema } from 'effect';
import { priceNativeStatic } from '../../../lib/payroll_engine/catalogues/static.js';
const columns = ['code', 'name', 'authority', 'counts_toward', 'statutory_admission', 'statutory_value', 'measurement', 'value_schema', 'inputs', 'records', 'derived', 'admission', 'eligibility', 'quantity', 'rate', 'amount', 'destination', 'direction'] as const;
const c = collection('allowance_catalogue', { read: { fields: 'all' }, queries: { price: { description: 'Price configured static allowance from actual caller-readable native inputs.', input: { profile_id: { kind: 'id', of: 'employee_profiles' }, day: { kind: 'date' }, run_id: { kind: 'id', of: 'payroll_runs', optional: true } }, output: { kind: 'json' } } }, create: { input: { columns: ['settings_id', ...columns] } }, update: { input: { columns } }, delete: { transform: true } });
export default c;
c.transform(async (inputs,ctx)=>{
 const rows=inputs.map(input=>plain(input));
 const stored=ctx.existing.map(value=>value==null?undefined:plain(value));
 const ids=[...new Set(rows.flatMap((row,index)=>['settings_id' in row?row.settings_id:undefined,stored[index]?.settings_id]).filter(id=>id!=null&&id!==''))];
 const versions=await versionsById(ctx.db,ids);
 const parents=await readAll<Record<string,unknown>>(ctx.db,'jurisdiction_settings',{id:{in:ids}});
 for(const [index,row] of rows.entries()){
  const before=stored[index],deleting='$delete' in row,next={...before,...row};
  refuseUnlessDraftOnBoth(versions,before?.settings_id,deleting?undefined:row.settings_id,'allowance_catalogue');
  if(deleting)continue;
  if(next.settings_id==null)continue; // Nested children are validated by the actual root transform.
  const parent=parents.find(value=>value.id===next.settings_id);if(!parent)refuse('Catalogue authoring requires its actual owning jurisdiction.');
  await validateCatalogueDraft('allowance_catalogue',next,parent);
 }
 return inputs;
});
c.query('price', async (input, ctx) => Schema.decodeUnknownSync(Schema.Json)(await priceNativeStatic(ctx, { catalog: 'ALLOWANCE', profile_id: String(input.profile_id), day: String(input.day), ...(input.run_id == null ? {} : { run_id: String(input.run_id) }), observation: { observedAt: String(ctx.now), timezone: ctx.tz } })));
