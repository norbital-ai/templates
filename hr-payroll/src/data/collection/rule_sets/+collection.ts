import {collection} from '@norbital-ai/bolt';
import {plain} from '../../../lib/payroll_engine/foundation/primitives.js';
import {versionsById,refuseUnlessDraftOnBoth} from '../../../lib/payroll_engine/catalogues/settings-seal.js';
import {readAll} from '../../../lib/payroll_engine/foundation/reads.js';
import {validateRuleSetDraft,ruleSetContentHash} from '../../../lib/payroll_engine/execution/rule-sets.js';
import {refuse} from '../../../lib/payroll_engine/foundation/primitives.js';
const columns=['scope','family','code','name','stage','eligibility','rules','source_identity'] as const;
const c=collection('rule_sets',{read:{fields:'all'},create:{input:{columns:['settings_id',...columns]}},update:{input:{columns}},delete:{transform:true}});
export default c;
c.transform(async(inputs,ctx)=>{
 const rows=inputs.map(input=>plain(input)),stored=ctx.existing.map(value=>value==null?undefined:plain(value));
 const ids=[...new Set(rows.flatMap((row,index)=>['settings_id' in row?row.settings_id:undefined,stored[index]?.settings_id]).filter(id=>id!=null&&id!==''))];
 const [versions,parents]=await Promise.all([versionsById(ctx.db,ids),readAll<Record<string,unknown>>(ctx.db,'jurisdiction_settings',{id:{in:ids}})]);
 const outputs=[];
 for(const [index,row] of rows.entries()){
  const before=stored[index],deleting='$delete' in row,next={...before,...row};
  if(next.scope==='GLOBAL'||before?.scope==='GLOBAL')refuse('Global original regulatory sources are immutable imported records; jurisdiction draft authority cannot mutate them.');
  if(next.scope!=null&&next.scope!=='JURISDICTION')refuse('Rule sets retain their declared jurisdiction or global ownership scope.');
  refuseUnlessDraftOnBoth(versions,before?.settings_id,deleting?undefined:row.settings_id,'rule_sets');
  if(deleting){outputs.push(inputs[index]!);continue;}
  if(next.settings_id==null)refuse('A jurisdiction rule set requires its actual owning jurisdiction draft.');
  const parent=parents.find(value=>value.id===next.settings_id);if(!parent)refuse('Rule set authoring requires its actual owning jurisdiction draft.');
  await validateRuleSetDraft(next,parent,ctx.db);
  outputs.push({...inputs[index]!,content_hash:await ruleSetContentHash(next)});
 }
 return outputs;
});
