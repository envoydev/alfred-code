export const API_URL = '/api';

/** Drops empty values so they are not sent as query parameters. */
export function queryParams(
  values: Record<string, string | number | null | undefined>,
): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== '') {
      params[key] = value;
    }
  }
  return params;
}

export function pageCount(totalCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalCount / pageSize));
}
