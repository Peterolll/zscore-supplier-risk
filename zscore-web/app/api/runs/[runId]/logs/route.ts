import { NextResponse } from 'next/server';
import { getDb, getRunDetail } from '@/lib/db';
import { readTrace } from '@/lib/audit';
export const runtime='nodejs';
export async function GET(_req:Request,{params}:{params:Promise<{runId:string}>}) {
  const {runId}=await params;
  const detail=getRunDetail(runId);
  if(!detail)return NextResponse.json({ok:false,error:'NOT_FOUND'},{status:404});
  const reviews=getDb().prepare('SELECT trace_id FROM run_trace WHERE run_id=?').all(runId) as {trace_id:string}[];
  const ids=[...new Set([detail.run.trace_id,...reviews.map(r=>r.trace_id)].filter((id):id is string=>!!id))];
  return NextResponse.json({ok:true,traces:ids.map(id=>({trace_id:id,events:readTrace(id)}))});
}
