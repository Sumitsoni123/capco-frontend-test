export interface JsonApiError {
  pointer?: string
  detail?: string
}

export async function readJsonApiErrors(
  response: Response,
): Promise<JsonApiError[]> {
  try {
    const payload: unknown = await response.json()
    if (!isRecord(payload) || !Array.isArray(payload.errors)) return []

    return payload.errors.flatMap((error): JsonApiError[] => {
      if (!isRecord(error)) return []
      const source = isRecord(error.source) ? error.source : undefined
      return [
        {
          pointer:
            source && typeof source.pointer === 'string'
              ? source.pointer
              : undefined,
          detail: typeof error.detail === 'string' ? error.detail : undefined,
        },
      ]
    })
  } catch {
    return []
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
