import { collection } from '@norbital-ai/bolt';
import { plain } from '../../../lib/payroll_engine/foundation/primitives.js';
import { versionsById, refuseUnlessDraftOnBoth } from '../../../lib/payroll_engine/catalogues/settings-seal.js';
import { readAll } from '../../../lib/payroll_engine/foundation/reads.js';
import { validateCatalogueDraft,validateCatalogueIntrinsicPolicies } from '../../../lib/payroll_engine/catalogues/authoring.js';
import { refuse } from '../../../lib/payroll_engine/foundation/primitives.js';
import {policyAdmissionFault} from '../../../lib/payroll_engine/catalogues/admission.js';
import * as Predicate from 'effect/Predicate';
const columns = ['code', 'name', 'authority', 'configuration'] as const;
const c = collection('statutory_contributions', { read: { fields: 'all' },  create: { input: { columns: ['settings_id', ...columns] } }, update: { input: { columns } }, delete: { transform: true } });
export default c;
c.transform(async (inputs,ctx)=>{
 const rows=inputs.map(input=>plain(input));
 const stored=ctx.existing.map(value=>value==null?undefined:plain(value));
 for(const [index,row] of rows.entries())if(!('$delete' in row))validateCatalogueIntrinsicPolicies('statutory_contributions',{...stored[index],...row});
 for(const [index,row] of rows.entries()) {
  if('$delete' in row)continue;
  const next={...stored[index],...row},configuration=next.configuration;
  if(Predicate.isObject(configuration)) {
   const policy=Reflect.get(configuration,'policy');
   if(Predicate.isObject(policy)&&Object.hasOwn(policy,'rules')) {
    const fault=policyAdmissionFault('contribution_rules',Reflect.get(policy,'rules'));if(fault!=null)refuse(fault);
   }
  }
 }
 const ids=[...new Set(rows.flatMap((row,index)=>['settings_id' in row?row.settings_id:undefined,stored[index]?.settings_id]).filter(id=>id!=null&&id!==''))];
 const versions=await versionsById(ctx.db,ids);
 const parents=await readAll<Record<string,unknown>>(ctx.db,'jurisdiction_settings',{id:{in:ids}});
 for(const [index,row] of rows.entries()){
  const before=stored[index],deleting='$delete' in row,next={...before,...row};
  refuseUnlessDraftOnBoth(versions,before?.settings_id,deleting?undefined:row.settings_id,'statutory_contributions');
  if(deleting)continue;
  if(next.settings_id==null)continue; // Nested children are validated by the actual root transform.
  const parent=parents.find(value=>value.id===next.settings_id);if(!parent)refuse('Catalogue authoring requires its actual owning jurisdiction.');
  await validateCatalogueDraft('statutory_contributions',next,parent);
 }
 return inputs;
});
