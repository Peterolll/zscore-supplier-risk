import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb, getRunDetail } from "@/lib/db";
import { runEngine } from "@/lib/engine";
import { audit } from "@/lib/audit";
export const runtime="nodejs";
export const maxDuration=330;

export async function POST(_req:Request,{params}:{params:Promise<{runId:string}>}) {
  const {runId}=await params;
  const detail=getRunDetail(runId);
  if(!detail)return NextResponse.json({ok:false,message:"批次不存在"},{status:404});
  const {supplier}=detail;
  if(supplier.metadata_unknown || supplier.period==="unknown" || supplier.gaap==="unknown" || !supplier.source_file || !/\.(xlsx|xlsm)$/i.test(supplier.source_file) || supplier.source_file.includes("|"))
    return NextResponse.json({ok:false,message:"该操作仅支持来源明确的单个 Excel 工作簿"},{status:400});
  const traceId=randomUUID(),db=getDb();
  db.prepare("INSERT INTO run_trace (trace_id,run_id,kind) VALUES (?,?,?)").run(traceId,runId,"excel_reextract");
  audit(traceId,"excel.reextract_started",{run_id:runId});
  try {
    const result=await runEngine({traceId,pdfPaths:[supplier.source_file],name:supplier.name,
      industry:supplier.industry,period:supplier.period,gaap:supplier.gaap,currency:supplier.currency,
      listed:supplier.listed===1,equityValue:supplier.equity_value,flowBasis:supplier.flow_basis});
    if(!result.ok || !result.extraction)throw new Error(result.message || result.error || "Excel 解析失败");
    const current=getRunDetail(runId)!;
    const suggestions=Object.entries(result.extraction.fields).filter(([,f])=>f.value!==null).map(([field_key,f])=>({
      ...f,id:randomUUID(),field_key,old_value:current.fields.find(x=>x.field_key===field_key)?.value ?? null,
    }));
    audit(traceId,"excel.previous_snapshot",{run_id:runId,extraction:current.run.extraction_json ? JSON.parse(current.run.extraction_json) : null});
    db.exec("BEGIN");
    try {
      // Replacing pending suggestions leaves confirmed financial fields untouched.
      db.prepare("UPDATE review_suggestion SET dismissed_at=datetime('now') WHERE run_id=? AND accepted_at IS NULL AND dismissed_at IS NULL").run(runId);
      const insert=db.prepare("INSERT INTO review_suggestion (id,run_id,field_key,old_value,new_value,payload,trace_id) VALUES (?,?,?,?,?,?,?)");
      for(const s of suggestions)insert.run(s.id,runId,s.field_key,s.old_value,s.value,JSON.stringify(s),traceId);
      db.prepare("UPDATE zscore_run SET extraction_json=? WHERE id=?").run(JSON.stringify(result.extraction),runId);
      db.exec("COMMIT");
    }catch(error){db.exec("ROLLBACK");throw error;}
    audit(traceId,"excel.reextract_completed",{run_id:runId,extraction:result.extraction});
    return NextResponse.json({ok:true,suggestions,trace_id:traceId,sheet_summary:result.extraction.sheet_summary,unextracted:result.extraction.unextracted,validation:{passed:result.zscore?.gates_passed,failed:result.zscore?.gates_failed,notes:result.zscore?.notes}});
  }catch(error){
    const message=error instanceof Error?error.message:"重新读取失败";
    audit(traceId,"excel.reextract_failed",{run_id:runId,message});
    return NextResponse.json({ok:false,message,trace_id:traceId},{status:422});
  }
}
