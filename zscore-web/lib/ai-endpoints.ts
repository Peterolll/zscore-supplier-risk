/** Single source of truth for business vision calls and compatible endpoint URLs. */
export function visionModelFor(baseUrl: string): string {
  return baseUrl.includes("bigmodel.cn") ? "glm-4v-flash" : "GLM-4V-Flash";
}
export function apiUrl(baseUrl: string, resource: "models" | "chat/completions"): string {
  const base=baseUrl.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  return `${base}${/\/(v1|v4)$/.test(base) ? "" : "/v1"}/${resource}`;
}
