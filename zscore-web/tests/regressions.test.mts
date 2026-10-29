// Financial amounts in these fixtures are synthetic.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { computeZ } from '../lib/zscore';
import type { AnalysisInput } from '../lib/db';

const original = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zscore-regression-'));
process.chdir(tmp);
const { saveAnalysis, getRunDetail, saveResultOverride, getDb, listSuppliers } = await import('../lib/db');
after(() => { getDb().close(); process.chdir(original); fs.rmSync(tmp,{recursive:true,force:true}); });
let n = 0;
function fixture(name = `audit-${++n}`): AnalysisInput {
  const values = {current_assets:600,current_liabilities:200,total_assets:1000,total_liabilities:400,equity_total:600,retained_earnings:200,revenue:1000,profit_before_tax:90,interest_expense:10,ebit:100};
  return {profile:{name,industry_class:'manufacturing',period_type:'annual',gaap:'cas',currency:'CNY',listed:true,equity_value:600,source_file:'old.pdf'},method:'manual',
    extraction:{fields:Object.fromEntries(Object.entries(values).map(([k,value])=>[k,{value,evidence:k==='ebit'?'PBT+利息':'audit',method:k==='ebit'?'derived':'pdfplumber',source_page:0,confidence:1}]))},
    zscore:{model:'Z',z_score:3,risk_zone:'safe',annualized:false,annualize_factor:1,gates_passed:[],gates_failed:[],notes:[],X1:.4,X2:.2,X3:.1,X4:1.5,X5:1}};
}
const factor = (id:string,key:string) => getRunDetail(id)!.factors.find(f=>f.key===key)!.value;
const field = (id:string,key:string) => getRunDetail(id)!.fields.find(f=>f.field_key===key)!.value;

test('all required factors including finite values are required',()=>{
  const complete={X1:.4,X2:.2,X3:.1,X4:1.5,X5:1};
  assert.equal(computeZ(complete,'Z'),2.99);
  for(const key of Object.keys(complete)) assert.equal(computeZ({...complete,[key]:null},'Z'),null);
  assert.equal(computeZ({...complete,X3:Infinity},'Z'),null);
  assert.notEqual(computeZ({...complete,X5:null},"Z''"),null);
});

test('same supplier new upload cannot change older run metadata or computation',()=>{
  const a=fixture('same-name');const first=saveAnalysis(a);
  const b=fixture('same-name');b.profile={...b.profile,source_file:'new.pdf',period_type:'q3',currency:'USD',equity_value:1200};
  const second=saveAnalysis(b);
  const old=getRunDetail(first.runId)!;
  assert.equal(old.supplier.source_file,'old.pdf');assert.equal(old.supplier.period,'annual');assert.equal(old.supplier.currency,'CNY');
  saveResultOverride(second.runId,{listed:false,industry:'service'});
  assert.equal(getRunDetail(first.runId)!.run.model,'Z');assert.equal(factor(first.runId,'X4'),1.5);
  assert.equal(listSuppliers().filter(x=>x.name==='same-name').length,1);
});

test('missing CA remains missing after save; clear and restore fields updates gates',()=>{
  const a=fixture();delete a.extraction.fields.current_assets;a.zscore.X1=null;
  const {runId}=saveAnalysis(a);assert.equal(getRunDetail(runId)!.run.z_score,null);
  saveResultOverride(runId,{fields:{revenue:1100}});assert.equal(factor(runId,'X1'),null);
  assert.equal(getRunDetail(runId)!.run.risk_zone,'unknown');
  saveResultOverride(runId,{fields:{current_assets:600}});assert.notEqual(getRunDetail(runId)!.run.z_score,null);
  assert.ok(getRunDetail(runId)!.run.gates_passed.includes('G5'));
  saveResultOverride(runId,{fields:{current_assets:null}});assert.equal(field(runId,'current_assets'),null);
  assert.ok(getRunDetail(runId)!.run.gates_failed.includes('G5'));
});

test('market cap alone recomputes X4 and null clears prior cap',()=>{
  const {runId}=saveAnalysis(fixture());saveResultOverride(runId,{equityValue:1200});
  assert.equal(factor(runId,'X4'),3);
  saveResultOverride(runId,{equityValue:null});assert.equal(getRunDetail(runId)!.supplier.equity_value,null);
  assert.equal(field(runId,'equity_value'),null);assert.equal(factor(runId,'X4'),1.5);
});

test('derived EBIT tracks PBT and interest; explicit EBIT is preserved and checked',()=>{
  const {runId}=saveAnalysis(fixture());saveResultOverride(runId,{fields:{profit_before_tax:190}});
  assert.equal(field(runId,'ebit'),200);assert.equal(factor(runId,'X3'),.2);
  saveResultOverride(runId,{fields:{interest_expense:20}});assert.equal(field(runId,'ebit'),210);
  saveResultOverride(runId,{fields:{ebit:999}});
  saveResultOverride(runId,{fields:{profit_before_tax:290}});assert.equal(field(runId,'ebit'),999);
  assert.ok(getRunDetail(runId)!.run.gates_failed.includes('G4'));
});

test('pre-snapshot migration preserves unknown metadata and invalidates partial scores',()=>{
  const {runId}=saveAnalysis(fixture('legacy'));
  const legacy=fs.mkdtempSync(path.join(tmp,'legacy-'));fs.mkdirSync(path.join(legacy,'data'));
  const filename=path.join(legacy,'data','zscore.db');getDb().prepare('VACUUM INTO ?').run(filename);
  const db=new DatabaseSync(filename);
  db.exec('ALTER TABLE zscore_run DROP COLUMN profile_snapshot; ALTER TABLE zscore_run DROP COLUMN ebit_derived');
  db.prepare("DELETE FROM factor WHERE run_id=? AND key='X1'").run(runId);db.close();
  const moduleUrl=new URL('../lib/db.ts',import.meta.url).href;
  const loader=path.join(original,'node_modules/tsx/dist/loader.mjs');
  const result=spawnSync(process.execPath,['--import',loader,'--input-type=module','-e',`const m=await import(${JSON.stringify(moduleUrl)}); const {getRunDetail,getDb}=m.default??m; console.log(JSON.stringify(getRunDetail(${JSON.stringify(runId)})));getDb().close();`],{cwd:legacy,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const data=JSON.parse(result.stdout);assert.equal(data.supplier.source_file,null);assert.equal(data.supplier.period,'unknown');assert.equal(data.supplier.metadata_unknown,true);assert.equal(data.run.z_score,null);assert.equal(data.run.risk_zone,'unknown');
});

test('PATCH accepts explicit null and rejects nonfinite numeric strings', async()=>{
  const { PATCH } = await import('../app/api/runs/[runId]/route');
  const {runId} = saveAnalysis(fixture());
  const send = (body:unknown) => PATCH(new Request('http://localhost/api/runs/'+runId,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({runId})});
  assert.equal((await send({fields:{current_assets:null},equityValue:null})).status,200);
  assert.equal(field(runId,'current_assets'),null);
  assert.equal(getRunDetail(runId)!.supplier.equity_value,null);
  assert.equal((await send({fields:{current_assets:'Infinity'}})).status,400);
});


test('notes-only PATCH preserves a legacy run calculation and manual risk', async()=>{
  const { PATCH } = await import('../app/api/runs/[runId]/route');
  const {runId}=saveAnalysis(fixture());
  saveResultOverride(runId,{equityValue:1200,riskOverride:'distress'});
  getDb().prepare('UPDATE zscore_run SET profile_snapshot=NULL WHERE id=?').run(runId);
  const before=getRunDetail(runId)!;
  const result=await PATCH(new Request('http://localhost/api/runs/'+runId,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({note:'legacy review',industry:'manufacturing',listed:true,equityValue:null})}),{params:Promise.resolve({runId})});
  assert.equal(result.status,200);
  const after=getRunDetail(runId)!;
  assert.equal(after.run.z_score,before.run.z_score);
  assert.deepEqual(after.factors,before.factors);
  assert.equal(after.run.risk_zone,'distress');
  assert.equal(after.override!.note,'legacy review');
  assert.equal(after.supplier.metadata_unknown,true);
  const clear=await PATCH(new Request('http://localhost/api/runs/'+runId,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({riskOverride:null})}),{params:Promise.resolve({runId})});
  assert.equal(clear.status,200);
  assert.equal(getRunDetail(runId)!.override!.risk_overridden,0);
  assert.equal(getRunDetail(runId)!.run.z_score,before.run.z_score);
  assert.equal(getRunDetail(runId)!.run.risk_zone,'safe');
});

test('native Excel upload, all-field text review, evidence acceptance and audit end to end',async()=>{
  const {saveAiConfig}=await import('../lib/ai-config');
  saveAiConfig({provider:'custom',base_url:'https://model.invalid/v1',api_key:'test-only-never-send-secret',vision_model:'unused-vision',text_model:'available-text-model'});
  const previous=process.env.ZSCORE_PYTHON;process.env.ZSCORE_PYTHON=path.resolve(original,'../.venv/bin/python3');
  const actual=globalThis.fetch;let calls=0;
  globalThis.fetch=async(_url,opts)=>{
    if(String(_url).endsWith('/models'))return new Response(JSON.stringify({data:[{id:'available-text-model'}]}));
    calls++;const body=JSON.parse(String(opts?.body));assert.equal(body.model,'available-text-model');assert.equal(typeof body.messages[1].content,'string');
    const context=JSON.parse(body.messages[1].content);
    const rows=context.requested.map((field_key:string)=>{const ref=context.evidence.find((c:{field_key:string})=>c.field_key===field_key);return {field_key,value:ref?.value??null,candidate_ids:ref?[ref.id]:[]};});
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(rows)},finish_reason:'stop'}]}),{status:200});
  };
  try {
    const ExcelJS=(await import('exceljs')).default;const wb=new ExcelJS.Workbook();const sheet=wb.addWorksheet('2025财报');
    sheet.addRows([['单位：元'],['项目','期末余额','年初余额'],['流动资产合计',3000.24,1800.55],['流动负债合计',2400.73,1400.63],['资产总计',5400.5,3500.14],['负债合计',3200.11,2000.35],['所有者权益合计',2200.39,1499.79]]);
    const buffer=await wb.xlsx.writeBuffer();const form=new FormData();form.append('file',new File([new Uint8Array(buffer)],'2025.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));form.append('name','xlsx-upload');
    const {POST:upload}=await import('../app/api/analyze/route');const response=await upload(new Request('http://localhost/api/analyze',{method:'POST',body:form}));const saved=await response.json();assert.equal(response.status,200,JSON.stringify(saved));assert.equal(calls,0);assert.equal(saved.result.method,'excel');
    const runId=saved.runId;assert.equal(field(runId,'current_assets'),null);assert.equal(getRunDetail(runId)!.run.z_score,null);assert.equal(getRunDetail(runId)!.pendingSuggestions!.find(f=>f.field_key==='current_assets')!.provenance![0].cell,'B3');saveResultOverride(runId,{fields:{current_assets:17}});
    const {POST:review}=await import('../app/api/runs/[runId]/ai-analyze/route');const reviewed=await review(new Request('http://localhost/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:'all'})}),{params:Promise.resolve({runId})});const data=await reviewed.json();assert.equal(reviewed.status,200,JSON.stringify(data));assert.equal(calls,1);
    const corrected=data.suggestions.find((s:{field_key:string})=>s.field_key==='current_assets');assert.equal(corrected.old_value,17);assert.equal(corrected.value,3000.24);assert.equal(field(runId,'current_assets'),17);
    saveResultOverride(runId,{fields:{current_assets:corrected.value},acceptedSuggestions:{current_assets:corrected.id}});
    const confirmed=getRunDetail(runId)!.fields.find(f=>f.field_key==='current_assets')!;assert.equal(confirmed.method,'ai_analyze');assert.equal(confirmed.provenance![0].raw_value,'3000.24');assert.equal(confirmed.provenance![0].cell,'B3');
    assert.throws(()=>saveResultOverride(runId,{fields:{current_assets:corrected.value},acceptedSuggestions:{current_assets:corrected.id}}),/STALE_SUGGESTION/);
    const {GET:logs}=await import('../app/api/runs/[runId]/logs/route');const logResponse=await logs(new Request('http://localhost/logs'),{params:Promise.resolve({runId})});const logText=await logResponse.text();assert.ok(logText.includes('excel.extracted'));assert.ok(logText.includes('text.request'));assert.ok(!logText.includes('test-only-never-send-secret'));
  } finally {globalThis.fetch=actual;if(previous===undefined)delete process.env.ZSCORE_PYTHON;else process.env.ZSCORE_PYTHON=previous;}
});

test('text review rejects unsupported values and preserves explicit zero',async()=>{
  const {reviewWithTextModel}=await import('../lib/ai-review');const actual=globalThis.fetch;
  globalThis.fetch=async(url)=>String(url).endsWith('/models') ? new Response(JSON.stringify({data:[{id:'available-text-model'}]})) : new Response(JSON.stringify({choices:[{message:{content:JSON.stringify([{field_key:'current_assets',value:999,candidate_ids:['a']},{field_key:'interest_expense',value:0,candidate_ids:['z']},{field_key:'ebit',value:10,candidate_ids:['p']}])},finish_reason:'stop'}]}));
  try {const suggestions=await reviewWithTextModel([{id:'a',field_key:'current_assets',value:100,raw_value:'100'},{id:'z',field_key:'interest_expense',value:0,raw_value:'0.00'},{id:'p',field_key:'profit_before_tax',value:10,raw_value:'10'}],{},['current_assets','interest_expense','ebit'],'offline-text-test');assert.equal(suggestions[0].value,null);assert.equal(suggestions[1].value,0);assert.equal(suggestions[2].value,null);}finally{globalThis.fetch=actual;}
});


test('model list validates exact IDs before any text call and shares endpoint/model config',async()=>{
  const {apiUrl,getAiConfig,saveAiConfig,listAvailableModels}=await import('../lib/ai-config');
  const {reviewWithTextModel}=await import('../lib/ai-review');
  const actual=globalThis.fetch;const calls:string[]=[];
  saveAiConfig({text_model:'missing-model'});
  globalThis.fetch=async(url)=>{calls.push(String(url));return new Response(JSON.stringify({data:[{id:'available-text-model'},{id:'GLM-4V-Flash'}]}));};
  try {
    assert.equal(apiUrl('https://example.test/v1/chat/completions','models'),'https://example.test/v1/models');
    assert.deepEqual(await listAvailableModels(),['GLM-4V-Flash','available-text-model']);
    await assert.rejects(()=>reviewWithTextModel([],{},['revenue'],'invalid-model-test'),/不在当前 Key/);
    assert.ok(calls.every(url=>url.endsWith('/models')));
    assert.equal(getAiConfig().vision_model,'GLM-4V-Flash');
    saveAiConfig({text_model:'available-text-model'});
  } finally {globalThis.fetch=actual;}
});

test('extraction is pending until explicit confirmation, supports manual correction and rejects cross-run acceptance',()=>{
  const input=fixture();input.method='excel';const {runId}=saveAnalysis(input);
  assert.ok(getRunDetail(runId)!.fields.every(f=>f.value===null));assert.equal(getRunDetail(runId)!.run.z_score,null);
  const suggestion=getRunDetail(runId)!.pendingSuggestions!.find(s=>s.field_key==='current_assets')!;
  assert.equal(suggestion.value,600);assert.equal(field(runId,'current_assets'),null);
  const other=saveAnalysis({...input,profile:{...input.profile,name:'other-pending'}});
  assert.throws(()=>saveResultOverride(other.runId,{fields:{current_assets:600},acceptedSuggestions:{current_assets:suggestion.id}}),/STALE_SUGGESTION/);
  saveResultOverride(runId,{fields:{current_assets:600},acceptedSuggestions:{current_assets:suggestion.id}});
  assert.equal(field(runId,'current_assets'),600);assert.ok(!getRunDetail(runId)!.pendingSuggestions!.some(s=>s.id===suggestion.id));
  saveResultOverride(runId,{fields:{revenue:123}});assert.equal(field(runId,'revenue'),123);
  assert.equal(getRunDetail(runId)!.fields.find(f=>f.field_key==='revenue')!.method,'manual');
  assert.equal(field(runId,'total_assets'),null);
});


test('cancelled suggestion survives refresh without changing financial fields and cannot be confirmed',async()=>{
  const {DELETE}=await import('../app/api/runs/[runId]/suggestions/route');
  const input=fixture();input.method='excel';const {runId}=saveAnalysis(input);
  const suggestion=getRunDetail(runId)!.pendingSuggestions!.find(s=>s.field_key==='current_assets')!;
  const response=await DELETE(new Request('http://localhost/suggestions',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:suggestion.id})}),{params:Promise.resolve({runId})});
  assert.equal(response.status,200);assert.equal(field(runId,'current_assets'),null);
  assert.ok(!getRunDetail(runId)!.pendingSuggestions!.some(s=>s.id===suggestion.id));
  assert.throws(()=>saveResultOverride(runId,{fields:{current_assets:600},acceptedSuggestions:{current_assets:suggestion.id}}),/STALE_SUGGESTION/);
});


test('explicit catalog is used only for network failure and invalidated when key changes',async()=>{
  const {getAiConfig,saveAiConfig,validateTextModel}=await import('../lib/ai-config');
  const actual=globalThis.fetch;
  saveAiConfig({text_model:'catalog-model',model_catalog:{ids:['catalog-model'],source:'user',updated_at:new Date().toISOString()}});
  try {
    globalThis.fetch=async()=>{throw new TypeError('fetch failed');};
    await validateTextModel(getAiConfig());
    globalThis.fetch=async()=>new Response('{}',{status:401});
    await assert.rejects(()=>validateTextModel(getAiConfig()),/HTTP 401/);
    saveAiConfig({api_key:'new-test-key-invalidates-catalog'});
    assert.equal(getAiConfig().model_catalog,undefined);
  }finally{globalThis.fetch=actual;}
});


test('confirmed derived EBIT is not erased by confirming an unrelated field',()=>{
  const input=fixture();input.method='excel';input.extraction.fields.ebit.dependencies=['profit_before_tax','interest_expense'];
  const {runId}=saveAnalysis(input);const suggestion=getRunDetail(runId)!.pendingSuggestions!.find(s=>s.field_key==='ebit')!;
  saveResultOverride(runId,{fields:{ebit:100},acceptedSuggestions:{ebit:suggestion.id}});
  assert.equal(field(runId,'ebit'),100);
  saveResultOverride(runId,{fields:{current_assets:600}});assert.equal(field(runId,'ebit'),100);
  saveResultOverride(runId,{fields:{profit_before_tax:90}});assert.equal(field(runId,'ebit'),null);
});

test('native workbook reread covers every sheet and creates pending revenue without any model call',async()=>{
  const ExcelJS=(await import('exceljs')).default;const wb=new ExcelJS.Workbook();
  const bs=wb.addWorksheet('资产负债表');bs.addRows([['单位：元'],['项目','期末余额'],['资产总计',1000]]);
  const income=wb.addWorksheet('利润表');income.addRows([['单位：元'],['名称','行次','本年累计金额','上期累计金额'],['营业收入',1,4600.36,17],['财务费用',2,96.8,1],['利润总额',3,-520.39,1]]);
  wb.addWorksheet('附注空页');const filename=path.join(tmp,'sheets.xlsx');await wb.xlsx.writeFile(filename);
  const input=fixture();input.method='excel';input.profile.source_file=filename;
  const {runId}=saveAnalysis(input);saveResultOverride(runId,{fields:{revenue:17}});
  const before=getRunDetail(runId)!.fields;
  const actual=globalThis.fetch,previous=process.env.ZSCORE_PYTHON;
  globalThis.fetch=async()=>{throw new Error('native Excel reread must not invoke models');};
  process.env.ZSCORE_PYTHON=path.resolve(original,'../.venv/bin/python3');
  try {
    const {POST}=await import('../app/api/runs/[runId]/reextract/route');
    const response=await POST(new Request('http://localhost/reread',{method:'POST'}),{params:Promise.resolve({runId})});
    const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));
    assert.deepEqual(data.sheet_summary.map((s:{sheet:string})=>s.sheet),['资产负债表','利润表','附注空页']);
    assert.equal(data.suggestions.find((s:{field_key:string})=>s.field_key==='revenue').value,4600.36);
    assert.equal(data.suggestions.find((s:{field_key:string})=>s.field_key==='finance_expenses').value,96.8);
    assert.deepEqual(getRunDetail(runId)!.fields,before);assert.equal(field(runId,'revenue'),17);
    const ref=data.suggestions.find((s:{field_key:string})=>s.field_key==='revenue');
    saveResultOverride(runId,{fields:{revenue:ref.value},acceptedSuggestions:{revenue:ref.id}});
    assert.equal(field(runId,'revenue'),4600.36);assert.equal(getRunDetail(runId)!.fields.find(f=>f.field_key==='revenue')!.method,'excel');
  }finally{globalThis.fetch=actual;if(previous===undefined)delete process.env.ZSCORE_PYTHON;else process.env.ZSCORE_PYTHON=previous;}
});

test('manual recomputation supports net profit plus tax plus interest, but never finance expenses alone',()=>{
  const input=fixture();delete input.extraction.fields.profit_before_tax;
  input.extraction.fields.ebit.dependencies=['net_profit','income_tax','interest_expense'];
  const {runId}=saveAnalysis(input);
  saveResultOverride(runId,{fields:{net_profit:-100,income_tax:20,interest_expense:5}});
  assert.equal(field(runId,'ebit'),-75);
  assert.deepEqual(getRunDetail(runId)!.fields.find(f=>f.field_key==='ebit')!.dependencies,['net_profit','income_tax','interest_expense']);
  saveResultOverride(runId,{fields:{net_profit:-200}});assert.equal(field(runId,'ebit'),-175);
  saveResultOverride(runId,{fields:{interest_expense:null,finance_expenses:999}});assert.equal(field(runId,'ebit'),null);
});


test('text review accepts complete after-tax EBIT route but rejects finance-expense substitution',async()=>{
  const {reviewWithTextModel}=await import('../lib/ai-review');
  const {saveAiConfig}=await import('../lib/ai-config');saveAiConfig({text_model:'text-test'});
  const actual=globalThis.fetch;
  const refs=[{id:'n',field_key:'net_profit',value:-100},{id:'t',field_key:'income_tax',value:20},{id:'i',field_key:'interest_expense',value:5},{id:'f',field_key:'finance_expenses',value:999}];
  let ids=['n','t','i'],value=-75;
  globalThis.fetch=async(url)=>String(url).endsWith('/models') ? new Response(JSON.stringify({data:[{id:'text-test'}]})) : new Response(JSON.stringify({choices:[{message:{content:JSON.stringify([{field_key:'ebit',value,candidate_ids:ids}])},finish_reason:'stop'}]}));
  try {
    const valid=await reviewWithTextModel(refs,{},['ebit'],'net-tax-interest-test');
    assert.equal(valid[0].value,-75);assert.deepEqual(valid[0].dependencies,['net_profit','income_tax','interest_expense']);
    ids=['n','t','f'];value=919;
    assert.equal((await reviewWithTextModel(refs,{},['ebit'],'finance-substitution-test'))[0].value,null);
  }finally{globalThis.fetch=actual;}
});
