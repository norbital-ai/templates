import {model} from '@norbital-ai/bolt';
export default model({
 description:'Regulatory rule sets grouped by family. Dated jurisdiction sets belong to a sealed jurisdiction version; original global policy sources retain explicit global ownership. Configuration holds eligibility, legal parameters and ordered programs, with qualified source identity.',
 icon:'lucide:list-checks',label:'name',
 fields:{
  scope:{kind:'text',default:'JURISDICTION'},
  family:{kind:'text'},code:{kind:'text'},name:{kind:'text'},
  stage:{kind:'text',optional:true},eligibility:{kind:'text',optional:true},
  rules:{kind:'json',help:'Authoritative family data, ordered entries and digest-keyed executable programs. No jurisdiction fallback supplies regulatory policy.'},
  content_hash:{kind:'text'},
  source_identity:{kind:'json',help:'Original jurisdiction/source location and hash plus retained source IDs. Newly authored native identity never impersonates a retired source row.'}
 },
 unique:[{fields:['settings_id','family','code']}],
 search:{text:['family','code','name']}
});
