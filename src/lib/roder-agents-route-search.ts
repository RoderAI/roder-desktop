export function validateRoderAgentsSearch(search: Record<string, unknown>): { create?: boolean } {
  return search.create === true || search.create === "true" ? { create: true } : {};
}
