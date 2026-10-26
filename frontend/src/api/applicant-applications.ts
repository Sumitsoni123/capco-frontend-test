export type ApplicantApplicationStep =
  'personal-details' | 'identity-and-address'

export interface ApplicantApplicationProgress {
  step: ApplicantApplicationStep
  state: 'not-started' | 'current' | 'complete'
}

export interface ApplicantApplicationFormStep {
  step: ApplicantApplicationStep
  state: 'current' | 'complete' | 'remaining'
}

export interface ApplicantApplicationDocument {
  data: {
    type: 'applicant-applications'
    id: string
    attributes: {
      status: 'draft'
      currentStep: ApplicantApplicationStep
      href: string
      progress: ApplicantApplicationProgress[]
    }
  }
}

export interface ApplicantApplicationAnswers {
  name?: string | null
  dateOfBirth?: string | null
  country?: string | null
  nationality?: string | null
  email?: string | null
  phone?: string | null
  consentConfirmed?: boolean | null
  documentType?: string | null
  documentNumber?: string | null
  documentCountry?: string | null
  expiry?: string | null
  street?: string | null
  city?: string | null
  postal?: string | null
  residentialCountry?: string | null
}

export interface ApplicantApplicationFormDocument {
  data: {
    type: 'applicant-application-forms'
    id: string
    attributes: {
      status: 'draft'
      currentStep: ApplicantApplicationStep
      steps: ApplicantApplicationFormStep[]
      answers: ApplicantApplicationAnswers
      documentEvidence: { present: boolean }
      version?: number
    }
  }
}

export interface ApplicantApplicationDocumentEvidenceDocument {
  data: {
    type: 'applicant-application-document-evidence'
    id: string
    attributes: { present: boolean }
  }
}

export class ApplicantApplicationApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ApplicantApplicationApiError'
  }
}

const jsonApiHeaders = {
  Accept: 'application/vnd.api+json',
}

export async function getCurrentApplicantApplication(): Promise<ApplicantApplicationDocument | null> {
  const response = await request('/api/v1/applicant-applications/current', {
    method: 'GET',
  })
  if (response.status === 204) return null
  return parseApplication(await readSuccessJson(response))
}

export async function createOrGetApplicantApplication(): Promise<ApplicantApplicationDocument> {
  const response = await request('/api/v1/applicant-applications', {
    method: 'POST',
    headers: csrfHeaders(),
  })
  return parseApplication(await readSuccessJson(response))
}

export async function getApplicantApplicationForm(
  applicationId: string,
): Promise<ApplicantApplicationFormDocument> {
  const response = await request(
    `/api/v1/applicant-applications/${encodeURIComponent(applicationId)}/form`,
    { method: 'GET' },
  )
  return parseForm(await readSuccessJson(response))
}

export async function saveApplicantApplicationForm(
  applicationId: string,
  formId: string,
  step: ApplicantApplicationStep,
  answers: ApplicantApplicationAnswers,
  version?: number,
): Promise<ApplicantApplicationFormDocument> {
  const response = await request(
    `/api/v1/applicant-applications/${encodeURIComponent(applicationId)}/form`,
    {
      method: 'PATCH',
      headers: {
        ...csrfHeaders(),
        'Content-Type': 'application/vnd.api+json',
      },
      body: JSON.stringify({
        data: {
          type: 'applicant-application-forms',
          id: formId,
          attributes: {
            step,
            answers,
            ...(version === undefined ? {} : { version }),
          },
        },
      }),
    },
  )
  return parseForm(await readSuccessJson(response))
}

export async function uploadApplicantApplicationDocumentEvidence(
  applicationId: string,
  file: File,
): Promise<ApplicantApplicationDocumentEvidenceDocument> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await request(
    `/api/v1/applicant-applications/${encodeURIComponent(applicationId)}/document-evidence`,
    {
      method: 'POST',
      headers: csrfHeaders(),
      body: formData,
    },
  )
  return parseEvidence(await readSuccessJson(response))
}

async function request(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        ...jsonApiHeaders,
        ...init.headers,
      },
    })
  } catch {
    throw new ApplicantApplicationApiError(
      0,
      'Unable to reach the service. Check your connection and try again.',
    )
  }
}

async function readSuccessJson(response: Response): Promise<unknown> {
  if (!response.ok) throw await readApiError(response)
  try {
    return await response.json()
  } catch {
    throw new ApplicantApplicationApiError(
      response.status,
      'The server returned an unreadable response.',
    )
  }
}

async function readApiError(
  response: Response,
): Promise<ApplicantApplicationApiError> {
  try {
    const payload: unknown = await response.json()
    if (isRecord(payload) && Array.isArray(payload.errors)) {
      const errors = payload.errors.filter(isRecord)
      const firstError = errors[0]
      const message = errors
        .map((error) => error.detail)
        .filter((detail): detail is string => typeof detail === 'string')
        .join(' ')
      return new ApplicantApplicationApiError(
        response.status,
        message || 'The request could not be completed.',
        firstError && typeof firstError.code === 'string'
          ? firstError.code
          : undefined,
      )
    }
  } catch {
    // Fall through to a status-based message when the response is not JSON.
  }
  return new ApplicantApplicationApiError(
    response.status,
    'The request could not be completed. Please try again.',
  )
}

function csrfHeaders(): Record<string, string> {
  const token = document.cookie
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith('XSRF-TOKEN='))
    ?.slice('XSRF-TOKEN='.length)
  if (!token) return {}
  try {
    return { 'X-XSRF-TOKEN': decodeURIComponent(token) }
  } catch {
    return { 'X-XSRF-TOKEN': token }
  }
}

function parseApplication(payload: unknown): ApplicantApplicationDocument {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new ApplicantApplicationApiError(
      200,
      'The server returned an invalid application response.',
    )
  }
  const data = payload.data
  if (
    data.type !== 'applicant-applications' ||
    typeof data.id !== 'string' ||
    !isRecord(data.attributes) ||
    typeof data.attributes.href !== 'string' ||
    !Array.isArray(data.attributes.progress)
  ) {
    throw new ApplicantApplicationApiError(
      200,
      'The server returned an invalid application response.',
    )
  }
  return payload as unknown as ApplicantApplicationDocument
}

function parseForm(payload: unknown): ApplicantApplicationFormDocument {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new ApplicantApplicationApiError(
      200,
      'The server returned an invalid form response.',
    )
  }
  const data = payload.data
  if (
    data.type !== 'applicant-application-forms' ||
    typeof data.id !== 'string' ||
    !isRecord(data.attributes) ||
    !isRecord(data.attributes.answers) ||
    !isRecord(data.attributes.documentEvidence) ||
    typeof data.attributes.documentEvidence.present !== 'boolean'
  ) {
    throw new ApplicantApplicationApiError(
      200,
      'The server returned an invalid form response.',
    )
  }
  return payload as unknown as ApplicantApplicationFormDocument
}

function parseEvidence(
  payload: unknown,
): ApplicantApplicationDocumentEvidenceDocument {
  if (
    !isRecord(payload) ||
    !isRecord(payload.data) ||
    payload.data.type !== 'applicant-application-document-evidence' ||
    typeof payload.data.id !== 'string' ||
    !isRecord(payload.data.attributes) ||
    typeof payload.data.attributes.present !== 'boolean'
  ) {
    throw new ApplicantApplicationApiError(
      201,
      'The server returned an invalid document upload response.',
    )
  }
  return payload as unknown as ApplicantApplicationDocumentEvidenceDocument
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
