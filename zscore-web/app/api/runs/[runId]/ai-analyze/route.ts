import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getDb, getRunDetail } from '@/lib/db';
import { runEngine } from '@/lib/engine';
import { hasAiConfig, getAiConfig } from '@/lib/ai-config';
import { audit } from '@/lib/audit';
import { REVIEW_FIELDS, reviewWithTextModel } from '@/lib/ai-review';

export const runtime='nodejs';
export const maxDuration=390;

export async function POST(req:Request,{params}:{params:Promise<{runId:string}>}) {
  const {runId}=await params;
  const detail=getRunDetail(runId);
  if(!detail)return NextResponse.json({ok:false,error:'RUN_NOT_FOUND'},{status:404});
  if(!hasAiConfig())return NextResponse.json({ok:false,error:'NO_API_KEY',message:'请先配置 API Key 与文本模型'},{status:400});
  const {supplier}=detail;
  if(supplier.metadata_unknown || supplier.period==='unknown' || supplier.gaap==='unknown' || !supplier.source_file)
    return NextResponse.json({ok:false,error:'UNKNOWN_REPORT_METADATA',message:'历史文件来源未知，请重新上传财报'},{status:409});
  let body:{scope?:string;fields?:unknown}={};
  try {body=await req.json();}catch{/* Empty body means fill missing fields. */}
  const old=Object.fromEntries(detail.fields.map(f=>[f.field_key,f.value]));
  const explicitFields=Array.isArray(body.fields)?body.fields:undefined;
  const requested=explicitFields?REVIEW_FIELDS.filter(k=>explicitFields.includes(k)):
    REVIEW_FIELDS.filter(k=>body.scope==='all' || old[k]==null);
  if(requested.length===0)return NextResponse.json({ok:true,suggestions:[],message:'没有缺失字段，可选择“重新核验全部”'});
  const traceId=randomUUID();
  getDb().prepare('INSERT INTO run_trace (trace_id,run_id,kind) VALUES (?,?,?)').run(traceId,runId,'review');
  audit(traceId,'review.started',{run_id:runId,scope:body.scope || 'missing',requested});
  try {
    // Both upload OCR and browser review use exactly the same Python preprocessor.
    const parsed=await runEngine({traceId,pdfPaths:supplier.source_file.split('|'),name:supplier.name,
      industry:supplier.industry,period:supplier.period,gaap:supplier.gaap,currency:supplier.currency,
      listed:supplier.listed===1,equityValue:supplier.equity_value,flowBasis:supplier.flow_basis});
    if(!parsed.ok)throw new Error(parsed.message || parsed.error || '财报解析失败');
    const candidates=parsed.extraction?.candidates || [];
    // Text model is invoked only in this user-triggered route, never during upload.
    const suggestions=await reviewWithTextModel(candidates,old,requested,traceId);
    const db=getDb();
    const statement=db.prepare('INSERT INTO review_suggestion (id,run_id,field_key,old_value,new_value,payload,trace_id) VALUES (?,?,?,?,?,?,?)');
    for(const suggestion of suggestions) {
      suggestion.id=randomUUID();
      statement.run(suggestion.id,runId,suggestion.field_key,suggestion.old_value,suggestion.value,JSON.stringify(suggestion),traceId);
    }
    audit(traceId,'review.completed',{run_id:runId,usable:suggestions.filter(s=>s.value!==null).length,requested:requested.length});
    return NextResponse.json({ok:true,suggestions,trace_id:traceId,mode:'text-evidence',models_used:[getAiConfig().text_model],requested_fields:requested,validation:{passed:parsed.zscore?.gates_passed,failed:parsed.zscore?.gates_failed,notes:parsed.zscore?.notes},
      message:suggestions.every(s=>s.value===null)?'没有可核验证据，请核对日志或补充原文':undefined});
  }catch(error) {
    const message=error instanceof Error?error.message:'复核失败';
    audit(traceId,'review.failed',{run_id:runId,message});
    return NextResponse.json({ok:false,error:'REVIEW_FAILED',message,trace_id:traceId},{status:422});
  }
}
