import { File as NodeFile } from 'node:buffer'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'

import {
  getApplicantApplicationForm,
  type ApplicantApplicationFormDocument,
} from '../../api/applicant-applications'
import { server } from '../../test/server'

import CurrentApplicationStepPage, {
  clientLoader as loadApplicationStep,
} from './$applicationId/$step'
import CurrentApplicationJourneyPage, {
  clientLoader as loadCurrentApplication,
} from './current'

const applicationId = '7b55f1d0-30f5-4909-b3f1-b9a760a46615'
const formId = '775c0d78-8bf2-40a4-a3cc-25e82f863a9e'
const currentApplicationUrl = '/api/v1/applicant-applications/current'
const applicationsUrl = '/api/v1/applicant-applications'
const formUrl = `${applicationsUrl}/${applicationId}/form`
const evidenceUrl = `${applicationsUrl}/${applicationId}/document-evidence`

const applicationDocument = {
  data: {
    type: 'applicant-applications',
    id: applicationId,
    attributes: {
      status: 'draft',
      currentStep: 'personal-details',
      href: `/applications/${applicationId}/personal-details`,
      progress: [
        { step: 'personal-details', state: 'current' },
        { step: 'identity-and-address', state: 'not-started' },
      ],
    },
  },
}

function formDocument(
  answers: ApplicantApplicationFormDocument['data']['attributes']['answers'] = {},
  version = 4,
  evidencePresent = false,
): ApplicantApplicationFormDocument {
  return {
    data: {
      type: 'applicant-application-forms',
      id: formId,
      attributes: {
        status: 'draft',
        currentStep: 'personal-details',
        steps: [
          { step: 'personal-details', state: 'current' },
          { step: 'identity-and-address', state: 'remaining' },
        ],
        answers,
        documentEvidence: { present: evidencePresent },
        version,
      },
    },
  }
}

function CurrentPath() {
  const location = useLocation()
  return <output aria-label="Current path">{location.pathname}</output>
}

function renderJourney(loaderData: unknown) {
  const props = {
    loaderData,
  } as unknown as Parameters<typeof CurrentApplicationJourneyPage>[0]
  return render(
    <MemoryRouter initialEntries={['/applications/current']}>
      <CurrentApplicationJourneyPage {...props} />
      <CurrentPath />
    </MemoryRouter>,
  )
}

function renderStep(
  step: 'personal-details' | 'identity-and-address',
  form: ApplicantApplicationFormDocument,
  includeUnrelatedForm = false,
) {
  const props = {
    params: { applicationId, step },
    loaderData: { kind: 'ready', form },
  } as unknown as Parameters<typeof CurrentApplicationStepPage>[0]
  return render(
    <MemoryRouter initialEntries={[`/applications/${applicationId}/${step}`]}>
      {includeUnrelatedForm ? (
        <form aria-label="Unrelated form">
          <input aria-label="Unrelated required field" required />
        </form>
      ) : null}
      <CurrentApplicationStepPage {...props} />
      <CurrentPath />
    </MemoryRouter>,
  )
}

function renderReview() {
  const props = {
    params: { applicationId, step: 'review' },
    loaderData: null,
  } as unknown as Parameters<typeof CurrentApplicationStepPage>[0]
  return render(
    <MemoryRouter initialEntries={[`/applications/${applicationId}/review`]}>
      <CurrentApplicationStepPage {...props} />
      <CurrentPath />
    </MemoryRouter>,
  )
}

async function loadStep(step: 'personal-details' | 'identity-and-address') {
  return loadApplicationStep({
    params: { applicationId, step },
    request: new Request(
      `http://localhost/applications/${applicationId}/${step}`,
    ),
  } as Parameters<typeof loadApplicationStep>[0])
}

function setCsrfCookie() {
  document.cookie = 'XSRF-TOKEN=test-csrf-token; path=/'
}

describe('Applicant save and resume', () => {
  it('requires confirmation before navigating from application review', async () => {
    const user = userEvent.setup()
    renderReview()

    const confirmation = screen.getByRole('checkbox')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(confirmation).toBeInvalid()
    expect(screen.getByLabelText('Current path')).toHaveTextContent(
      `/applications/${applicationId}/review`,
    )

    await user.click(confirmation)
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(screen.getByLabelText('Current path')).toHaveTextContent(
      `/applications/${applicationId}/submitted`,
    )
  })

  it('loads a current draft and resumes to its API-provided href', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(currentApplicationUrl, () =>
        HttpResponse.json(applicationDocument, { status: 200 }),
      ),
    )
    const loaderData = await loadCurrentApplication({
      request: new Request('http://localhost/applications/current'),
    } as Parameters<typeof loadCurrentApplication>[0])
    renderJourney(loaderData)

    expect(
      screen.getByRole('heading', { name: 'Resume your KYC application' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resume application' }))

    expect(screen.getByLabelText('Current path')).toHaveTextContent(
      applicationDocument.data.attributes.href,
    )
  })

  it('preserves query parameters when redirecting an expired journey session', async () => {
    server.use(
      http.get(currentApplicationUrl, () =>
        HttpResponse.json(
          { errors: [{ detail: 'Sign in to continue.' }] },
          { status: 401 },
        ),
      ),
    )

    let redirectResponse: unknown
    try {
      await loadCurrentApplication({
        request: new Request(
          'http://localhost/applications/current?locale=en&ref=dashboard',
        ),
      } as Parameters<typeof loadCurrentApplication>[0])
    } catch (error) {
      redirectResponse = error
    }

    expect(redirectResponse).toBeInstanceOf(Response)
    if (redirectResponse instanceof Response) {
      const location = redirectResponse.headers.get('Location')
      expect(location).not.toBeNull()
      expect(
        new URL(location!, 'http://localhost').searchParams.get('returnTo'),
      ).toBe('/applications/current?locale=en&ref=dashboard')
    }
  })

  it('preserves query parameters when redirecting an expired form session', async () => {
    server.use(
      http.get(formUrl, () =>
        HttpResponse.json(
          { errors: [{ detail: 'Sign in to continue.' }] },
          { status: 401 },
        ),
      ),
    )

    let redirectResponse: unknown
    try {
      await loadApplicationStep({
        params: { applicationId, step: 'personal-details' },
        request: new Request(
          `http://localhost/applications/${applicationId}/personal-details?locale=en&ref=dashboard`,
        ),
      } as Parameters<typeof loadApplicationStep>[0])
    } catch (error) {
      redirectResponse = error
    }

    expect(redirectResponse).toBeInstanceOf(Response)
    if (redirectResponse instanceof Response) {
      const location = redirectResponse.headers.get('Location')
      expect(location).not.toBeNull()
      expect(
        new URL(location!, 'http://localhost').searchParams.get('returnTo'),
      ).toBe(
        `/applications/${applicationId}/personal-details?locale=en&ref=dashboard`,
      )
    }
  })

  it('shows Start when no draft exists and creates one with the CSRF token', async () => {
    const user = userEvent.setup()
    setCsrfCookie()
    server.use(
      http.get(
        currentApplicationUrl,
        () => new HttpResponse(null, { status: 204 }),
      ),
      http.post(applicationsUrl, ({ request }) => {
        expect(request.headers.get('X-XSRF-TOKEN')).toBe('test-csrf-token')
        return HttpResponse.json(applicationDocument, { status: 201 })
      }),
    )
    const loaderData = await loadCurrentApplication({
      request: new Request('http://localhost/applications/current'),
    } as Parameters<typeof loadCurrentApplication>[0])
    renderJourney(loaderData)

    expect(
      screen.getByRole('heading', { name: 'Start your KYC application' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start application' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Current path')).toHaveTextContent(
        applicationDocument.data.attributes.href,
      ),
    )
  })

  it('validates the submitted step form rather than an unrelated page form', async () => {
    const user = userEvent.setup()
    server.use(
      http.patch(formUrl, () =>
        HttpResponse.json(
          formDocument(
            {
              name: 'Ada Lovelace',
              dateOfBirth: '1815-12-10',
              country: 'United Kingdom',
              nationality: 'British',
              email: 'ada@example.com',
              phone: '555-0100',
              consentConfirmed: true,
            },
            5,
          ),
          { status: 200 },
        ),
      ),
    )
    renderStep('personal-details', formDocument(), true)

    await user.type(screen.getByLabelText('Name'), 'Ada Lovelace')
    await user.type(screen.getByLabelText('Date of birth'), '1815-12-10')
    await user.type(screen.getByLabelText('Country'), 'United Kingdom')
    await user.type(screen.getByLabelText('Nationality'), 'British')
    await user.type(screen.getByLabelText('Email'), 'ada@example.com')
    await user.type(screen.getByLabelText('Phone'), '555-0100')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Current path')).toHaveTextContent(
        `/applications/${applicationId}/identity-and-address`,
      ),
    )
  })

  it('hydrates saved answers and saves only this step with form ID, version, and CSRF', async () => {
    const user = userEvent.setup()
    setCsrfCookie()
    let savedForm = formDocument({
      name: 'Ada Lovelace',
      dateOfBirth: '1815-12-10',
      country: 'United Kingdom',
      nationality: 'British',
      email: 'ada@example.com',
      phone: '555-0100',
      consentConfirmed: true,
    })
    let savedRequest: Record<string, unknown> | undefined
    let completeSave: () => void = () => undefined
    const saveResponse = new Promise<void>((resolve) => {
      completeSave = resolve
    })
    server.use(
      http.get(formUrl, () => HttpResponse.json(savedForm, { status: 200 })),
      http.patch(formUrl, async ({ request }) => {
        expect(request.headers.get('X-XSRF-TOKEN')).toBe('test-csrf-token')
        expect(request.headers.get('Content-Type')).toBe(
          'application/vnd.api+json',
        )
        savedRequest = (await request.json()) as Record<string, unknown>
        savedForm = formDocument(
          {
            ...savedForm.data.attributes.answers,
            ...((
              savedRequest.data as {
                attributes: { answers: Record<string, unknown> }
              }
            ).attributes
              .answers as ApplicantApplicationFormDocument['data']['attributes']['answers']),
          },
          5,
        )
        await saveResponse
        return HttpResponse.json(savedForm, { status: 200 })
      }),
    )
    const loaderData = await loadStep('personal-details')
    expect(loaderData).toMatchObject({ kind: 'ready' })
    const form = (
      loaderData as { kind: 'ready'; form: ApplicantApplicationFormDocument }
    ).form
    renderStep('personal-details', form)

    expect(screen.getByLabelText('Name')).toHaveValue('Ada Lovelace')
    expect(screen.getByLabelText('Date of birth')).toHaveValue('1815-12-10')
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com')
    expect(screen.getByRole('checkbox')).toBeChecked()

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Ada Byron')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => expect(savedRequest).toBeDefined())
    expect(
      screen.queryByText('Your form answers were saved.'),
    ).not.toBeInTheDocument()
    completeSave()
    expect(
      await screen.findByText('Your form answers were saved.'),
    ).toBeInTheDocument()
    expect(savedRequest).toEqual({
      data: {
        type: 'applicant-application-forms',
        id: formId,
        attributes: {
          step: 'personal-details',
          answers: {
            name: 'Ada Byron',
            dateOfBirth: '1815-12-10',
            country: 'United Kingdom',
            nationality: 'British',
            email: 'ada@example.com',
            phone: '555-0100',
            consentConfirmed: true,
          },
          version: 4,
        },
      },
    })

    const reloadedForm = await getApplicantApplicationForm(applicationId)
    expect(reloadedForm.data.attributes.answers.name).toBe('Ada Byron')
    expect(reloadedForm.data.attributes.version).toBe(5)
  })

  it('saves identity answers, uploads evidence, and shows it on return', async () => {
    const user = userEvent.setup()
    setCsrfCookie()
    const identityAnswers = {
      documentType: 'Passport',
      documentNumber: 'P1234567',
      documentCountry: 'United Kingdom',
      expiry: '2030-10-21',
      street: '10 Example Street',
      city: 'London',
      postal: 'SW1A 1AA',
      residentialCountry: 'United Kingdom',
    }
    let identityForm = formDocument(identityAnswers, 7)
    let savedRequest: Record<string, unknown> | undefined
    let finishUpload: () => void = () => undefined
    let uploadRequested: () => void = () => undefined
    const uploadResponse = new Promise<void>((resolve) => {
      finishUpload = resolve
    })
    const uploadStarted = new Promise<void>((resolve) => {
      uploadRequested = resolve
    })
    server.use(
      http.get(formUrl, () => HttpResponse.json(identityForm, { status: 200 })),
      http.patch(formUrl, async ({ request }) => {
        savedRequest = (await request.json()) as Record<string, unknown>
        identityForm = formDocument(
          {
            ...identityForm.data.attributes.answers,
            ...((
              savedRequest.data as {
                attributes: { answers: Record<string, unknown> }
              }
            ).attributes
              .answers as ApplicantApplicationFormDocument['data']['attributes']['answers']),
          },
          8,
        )
        return HttpResponse.json(identityForm, { status: 200 })
      }),
      http.post(evidenceUrl, async ({ request }) => {
        expect(request.headers.get('X-XSRF-TOKEN')).toBe('test-csrf-token')
        expect(request.headers.get('Content-Type')).toMatch(
          /^multipart\/form-data; boundary=/,
        )
        const multipartBody = await request.text()
        expect(multipartBody).toContain('name="file"')
        uploadRequested()
        await uploadResponse
        identityForm = formDocument(
          identityForm.data.attributes.answers,
          8,
          true,
        )
        return HttpResponse.json(
          {
            data: {
              type: 'applicant-application-document-evidence',
              id: 'de058d18-c733-433c-9cc4-61a73b64f170',
              attributes: { present: true },
            },
          },
          { status: 201 },
        )
      }),
    )
    const loaderData = await loadStep('identity-and-address')
    const form = (
      loaderData as {
        kind: 'ready'
        form: ApplicantApplicationFormDocument
      }
    ).form
    renderStep('identity-and-address', form)

    expect(screen.getByLabelText('Document type')).toHaveValue('Passport')
    expect(screen.getByLabelText('Document number')).toHaveValue('P1234567')
    expect(screen.getByLabelText('Document country')).toHaveValue(
      'United Kingdom',
    )
    expect(screen.getByLabelText('Expiry')).toHaveValue('2030-10-21')
    expect(screen.getByLabelText('Street')).toHaveValue('10 Example Street')
    expect(screen.getByLabelText('City')).toHaveValue('London')
    expect(screen.getByLabelText('Postal code')).toHaveValue('SW1A 1AA')
    expect(screen.getByLabelText('Residential country')).toHaveValue(
      'United Kingdom',
    )
    expect(
      screen.queryByText(
        'Your identity document is on file. You can continue without uploading it again.',
      ),
    ).not.toBeInTheDocument()
    const evidenceInput = screen.getByLabelText(
      /Document evidence/,
    ) as HTMLInputElement
    expect(evidenceInput).toBeRequired()

    await user.clear(screen.getByLabelText('Document number'))
    await user.type(screen.getByLabelText('Document number'), 'P7654321')
    const evidenceFile = new NodeFile(['fake image'], 'passport.png', {
      type: 'image/png',
    }) as unknown as File
    Object.defineProperty(evidenceInput, 'files', {
      configurable: true,
      value: [evidenceFile],
    })
    fireEvent.change(evidenceInput)
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => expect(savedRequest).toBeDefined())
    await uploadStarted
    expect(evidenceInput.files?.[0]?.name).toBe('passport.png')
    expect(
      screen.queryByText('Your form answers were saved.'),
    ).not.toBeInTheDocument()
    finishUpload()
    expect(
      await screen.findByText('Your form answers were saved.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Your identity document is on file. You can continue without uploading it again.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/Document evidence/)).not.toBeRequired()
    expect(
      screen.getByText('Document evidence (already on file)'),
    ).toBeInTheDocument()
    expect(evidenceInput).not.toBeRequired()
    expect(evidenceInput).toHaveValue('')
    expect(savedRequest).toEqual({
      data: {
        type: 'applicant-application-forms',
        id: formId,
        attributes: {
          step: 'identity-and-address',
          answers: {
            ...identityAnswers,
            documentNumber: 'P7654321',
          },
          version: 7,
        },
      },
    })
    const reloadedForm = await getApplicantApplicationForm(applicationId)
    expect(reloadedForm.data.attributes.documentEvidence.present).toBe(true)
  })

  it('keeps the selected file and answers when upload fails, then allows retry', async () => {
    const user = userEvent.setup()
    setCsrfCookie()
    let currentForm = formDocument({ documentNumber: 'P1234567' }, 6)
    let uploadAttempts = 0
    server.use(
      http.patch(formUrl, async ({ request }) => {
        const payload = (await request.json()) as {
          data: { attributes: { answers: Record<string, unknown> } }
        }
        currentForm = formDocument(
          {
            ...currentForm.data.attributes.answers,
            ...payload.data.attributes.answers,
          },
          (currentForm.data.attributes.version ?? 0) + 1,
        )
        return HttpResponse.json(currentForm, { status: 200 })
      }),
      http.post(evidenceUrl, async ({ request }) => {
        expect(request.headers.get('X-XSRF-TOKEN')).toBe('test-csrf-token')
        expect(request.headers.get('Content-Type')).toMatch(
          /^multipart\/form-data; boundary=/,
        )
        uploadAttempts += 1
        if (uploadAttempts === 1) {
          return HttpResponse.json(
            {
              errors: [
                {
                  status: '422',
                  code: 'unprocessable-form',
                  title: 'Form could not be saved',
                  detail: 'The selected document could not be uploaded.',
                },
              ],
            },
            { status: 422 },
          )
        }
        currentForm = formDocument(
          currentForm.data.attributes.answers,
          currentForm.data.attributes.version,
          true,
        )
        return HttpResponse.json(
          {
            data: {
              type: 'applicant-application-document-evidence',
              id: 'de058d18-c733-433c-9cc4-61a73b64f170',
              attributes: { present: true },
            },
          },
          { status: 201 },
        )
      }),
    )
    renderStep('identity-and-address', currentForm)
    const fileInput = screen.getByLabelText(
      /Document evidence/,
    ) as HTMLInputElement
    const evidenceFile = new File(['fake image'], 'passport.png', {
      type: 'image/png',
    })
    await user.upload(fileInput, evidenceFile)
    await user.clear(screen.getByLabelText('Document number'))
    await user.type(screen.getByLabelText('Document number'), 'P7654321')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your form answers were saved, but the document upload failed.',
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The selected document could not be uploaded.',
    )
    expect(screen.getByLabelText('Document number')).toHaveValue('P7654321')
    expect(fileInput.files?.[0]?.name).toBe('passport.png')
    expect(
      screen.queryByText('Your form answers were saved.'),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(
      await screen.findByText(
        'Your identity document is on file. You can continue without uploading it again.',
      ),
    ).toBeInTheDocument()
    expect(fileInput).not.toBeRequired()
    expect(uploadAttempts).toBe(2)
  })

  it.each([
    [401, 'Your session has expired.', 'Sign in'],
    [409, 'This draft changed elsewhere.', undefined],
    [422, 'The submitted form could not be accepted.', undefined],
  ])(
    'preserves edits and explains API status %s',
    async (status, message, signInLabel) => {
      const user = userEvent.setup()
      server.use(
        http.patch(formUrl, () =>
          HttpResponse.json(
            {
              errors: [
                {
                  status: String(status),
                  code:
                    status === 409
                      ? 'form-version-conflict'
                      : 'unprocessable-form',
                  title: 'Form error',
                  detail:
                    status === 409
                      ? 'This draft changed elsewhere. Reload the form and try again.'
                      : 'The submitted form could not be accepted.',
                },
              ],
            },
            { status },
          ),
        ),
      )
      renderStep('personal-details', formDocument({ name: 'Ada Lovelace' }))
      await user.clear(screen.getByLabelText('Name'))
      await user.type(screen.getByLabelText('Name'), 'Unsaved edit')
      await user.click(screen.getByRole('button', { name: 'Save draft' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      expect(screen.getByLabelText('Name')).toHaveValue('Unsaved edit')
      if (signInLabel) {
        expect(
          screen.getByRole('link', { name: signInLabel }),
        ).toBeInTheDocument()
      }
      expect(
        screen.queryByText('Your draft was saved.'),
      ).not.toBeInTheDocument()
    },
  )

  it('preserves edits and offers retry feedback when the save request fails offline', async () => {
    const user = userEvent.setup()
    server.use(http.patch(formUrl, () => HttpResponse.error()))
    renderStep('personal-details', formDocument({ name: 'Ada Lovelace' }))
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Unsaved edit')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check your connection and try again.',
    )
    expect(screen.getByLabelText('Name')).toHaveValue('Unsaved edit')
    expect(screen.queryByText('Your draft was saved.')).not.toBeInTheDocument()
  })
})
