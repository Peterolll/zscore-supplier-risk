import fs from "node:fs";
import path from "node:path";
import { getAiConfig } from "./ai-config";

export function traceDirectory(id: string): string {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error("INVALID_TRACE_ID");
  return path.join(process.cwd(), "data", "traces", id);
}
export function audit(id: string, stage: string, details: object = {}): void {
  const dir = traceDirectory(id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const secret=getAiConfig().api_key;
  let record=JSON.stringify({time:new Date().toISOString(),trace_id:id,stage,...details},(key,value)=>/api_key|authorization|access_token/i.test(key) ? '[REDACTED]' : value);
  if(secret) record=record.split(secret).join('[REDACTED]');
  fs.appendFileSync(path.join(dir, "events.jsonl"), record+"\n", {mode:0o600});
}
export function readTrace(id: string): unknown[] {
  const file = path.join(traceDirectory(id), "events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file,"utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
}
