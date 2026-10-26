import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Link,
  Stack,
  TextField,
  Typography,
} from '@kyc/ui'
import { useRef, useState } from 'react'
import { redirect, useNavigate, type NavigateFunction } from 'react-router'

import { accountAccessHref } from '../../-return-target'
import {
  ApplicantApplicationApiError,
  getApplicantApplicationForm,
  saveApplicantApplicationForm,
  uploadApplicantApplicationDocumentEvidence,
  type ApplicantApplicationAnswers,
  type ApplicantApplicationFormDocument,
  type ApplicantApplicationStep,
} from '../../../api/applicant-applications'
import styles from '../../application-step.module.css'

import type { Route } from './+types/$step'

type FormLoaderData =
  | { kind: 'ready'; form: ApplicantApplicationFormDocument }
  | { kind: 'error'; status: number; message: string }

const fields: Record<
  ApplicantApplicationStep,
  { key: keyof ApplicantApplicationAnswers; label: string; type?: string }[]
> = {
  'personal-details': [
    { key: 'name', label: 'Name' },
    { key: 'dateOfBirth', label: 'Date of birth', type: 'date' },
    { key: 'country', label: 'Country' },
    { key: 'nationality', label: 'Nationality' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'phone', label: 'Phone', type: 'tel' },
  ],
  'identity-and-address': [
    { key: 'documentType', label: 'Document type' },
    { key: 'documentNumber', label: 'Document number' },
    { key: 'documentCountry', label: 'Document country' },
    { key: 'expiry', label: 'Expiry', type: 'date' },
    { key: 'street', label: 'Street' },
    { key: 'city', label: 'City' },
    { key: 'postal', label: 'Postal code' },
    { key: 'residentialCountry', label: 'Residential country' },
  ],
}

const answerKeys: Record<
  ApplicantApplicationStep,
  (keyof ApplicantApplicationAnswers)[]
> = {
  'personal-details': [
    ...fields['personal-details'].map(({ key }) => key),
    'consentConfirmed',
  ],
  'identity-and-address': fields['identity-and-address'].map(({ key }) => key),
}

export async function clientLoader({
  params,
  request,
}: Route.ClientLoaderArgs): Promise<FormLoaderData | null> {
  if (params.step === 'review') return null
  if (!isApplicationStep(params.step)) {
    return {
      kind: 'error',
      status: 404,
      message: 'This application step could not be found.',
    }
  }

  try {
    return {
      kind: 'ready',
      form: await getApplicantApplicationForm(params.applicationId),
    }
  } catch (error) {
    const status =
      error instanceof ApplicantApplicationApiError ? error.status : 0
    if (status === 401) {
      const url = new URL(request.url)
      throw redirect(
        accountAccessHref('/sign-in', `${url.pathname}${url.search}`),
      )
    }
    return {
      kind: 'error',
      status,
      message:
        error instanceof Error
          ? error.message
          : 'The saved form could not be loaded. Please try again.',
    }
  }
}

export default function CurrentApplicationStepPage({
  params,
  loaderData,
}: Route.ComponentProps) {
  const navigate = useNavigate()
  if (params.step === 'review') {
    return (
      <main className={styles.reviewPage}>
        <Card className={styles.reviewCard}>
          <CardContent>
            <Stack
              component="form"
              onSubmit={(event) => {
                event.preventDefault()
                if (!event.currentTarget.reportValidity()) return
                void navigate(`/applications/${params.applicationId}/submitted`)
              }}
              spacing={2}
            >
              <Typography component="h1" variant="heading">
                Review application
              </Typography>
              <Typography>Your application is ready for review.</Typography>
              <label>
                <input required type="checkbox" /> I confirm the information is
                complete and accurate.
              </label>
              <Button type="submit">Submit</Button>
              <Button
                type="button"
                variant="secondary"
                onPress={() =>
                  void navigate(
                    `/applications/${params.applicationId}/identity-and-address`,
                  )
                }
              >
                Return to form
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (loaderData?.kind === 'error') {
    return (
      <main className={styles.page}>
        <Alert role="alert" severity="error">
          {loaderData.message}
          {loaderData.status === 401 ? (
            <Link
              href={accountAccessHref(
                '/sign-in',
                `/applications/${params.applicationId}/${params.step}`,
              )}
            >
              Sign in
            </Link>
          ) : null}
        </Alert>
      </main>
    )
  }

  if (!loaderData || loaderData.kind !== 'ready') return null

  return (
    <LoadedApplicationStep
      key={`${params.applicationId}:${params.step}:${loaderData.form.data.id}`}
      applicationId={params.applicationId}
      form={loaderData.form}
      navigate={navigate}
      step={params.step as ApplicantApplicationStep}
    />
  )
}

function LoadedApplicationStep({
  applicationId,
  form,
  navigate,
  step,
}: {
  applicationId: string
  form: ApplicantApplicationFormDocument
  navigate: NavigateFunction
  step: ApplicantApplicationStep
}) {
  const [currentForm, setCurrentForm] = useState(form)
  const [answers, setAnswers] = useState<ApplicantApplicationAnswers>(
    form.data.attributes.answers,
  )
  const [error, setError] = useState<string>()
  const [sessionExpired, setSessionExpired] = useState(false)
  const [saved, setSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [evidenceFile, setEvidenceFile] = useState<File>()
  const savingRef = useRef(false)
  const evidenceInput = useRef<HTMLInputElement>(null)

  function updateAnswer(
    key: keyof ApplicantApplicationAnswers,
    value: string | boolean,
  ) {
    setAnswers((current) => ({ ...current, [key]: value }))
    setSaved(false)
    setError(undefined)
    setSessionExpired(false)
  }

  async function saveDraft(): Promise<boolean> {
    if (savingRef.current) return false
    savingRef.current = true
    setIsSaving(true)
    setError(undefined)
    setSessionExpired(false)
    setSaved(false)

    const stepAnswers = Object.fromEntries(
      answerKeys[step].flatMap((key) =>
        answers[key] === undefined ? [] : [[key, answers[key]]],
      ),
    ) as ApplicantApplicationAnswers

    let answersSaved = false
    try {
      const updatedForm = await saveApplicantApplicationForm(
        applicationId,
        currentForm.data.id,
        step,
        stepAnswers,
        currentForm.data.attributes.version,
      )
      setCurrentForm(updatedForm)
      setAnswers((current) => ({
        ...current,
        ...updatedForm.data.attributes.answers,
      }))
      answersSaved = true

      if (step === 'identity-and-address' && evidenceFile) {
        const uploadedEvidence =
          await uploadApplicantApplicationDocumentEvidence(
            applicationId,
            evidenceFile,
          )
        if (!uploadedEvidence.data.attributes.present) {
          throw new ApplicantApplicationApiError(
            201,
            'The document upload could not be confirmed.',
          )
        }
        setCurrentForm((current) => ({
          ...current,
          data: {
            ...current.data,
            attributes: {
              ...current.data.attributes,
              documentEvidence: { present: true },
            },
          },
        }))
        setEvidenceFile(undefined)
        if (evidenceInput.current) evidenceInput.current.value = ''
      }

      setSaved(true)
      return true
    } catch (cause) {
      setError(
        answersSaved
          ? evidenceUploadErrorMessage(cause)
          : saveErrorMessage(cause),
      )
      setSessionExpired(
        cause instanceof ApplicantApplicationApiError && cause.status === 401,
      )
      return false
    } finally {
      savingRef.current = false
      setIsSaving(false)
    }
  }

  async function advance(form: HTMLFormElement): Promise<void> {
    if (!form.reportValidity()) return
    if (!(await saveDraft())) return
    if (step === 'personal-details') {
      void navigate(`/applications/${applicationId}/identity-and-address`)
    } else {
      void navigate(`/applications/${applicationId}/review`)
    }
  }

  const continueLabel =
    step === 'personal-details' ? 'Continue' : 'Save and review'

  return (
    <main className={styles.page}>
      <Box component="div" className={styles.stepContent}>
        <Stack spacing={3}>
          <Typography component="p" variant="eyebrow" tone="accent">
            STEP {step === 'personal-details' ? '1' : '2'} OF 2
          </Typography>
          <Typography component="h1" variant="heading">
            {step === 'personal-details'
              ? 'Personal details'
              : 'Identity and address'}
          </Typography>
          <Typography tone="muted">
            Save draft stores your form answers. Document evidence uses a
            separate upload process.
          </Typography>
          {currentForm.data.attributes.documentEvidence.present ? (
            <Alert severity="info">
              Your identity document is on file. You can continue without
              uploading it again.
            </Alert>
          ) : null}
          {error ? (
            <Alert role="alert" severity="error">
              {error}{' '}
              {sessionExpired ? (
                <Link
                  href={accountAccessHref(
                    '/sign-in',
                    `/applications/${applicationId}/${step}`,
                  )}
                  onClick={(event) => {
                    event.preventDefault()
                    void navigate(
                      accountAccessHref(
                        '/sign-in',
                        `/applications/${applicationId}/${step}`,
                      ),
                    )
                  }}
                >
                  Sign in
                </Link>
              ) : null}
            </Alert>
          ) : null}
          {saved ? (
            <Alert role="status" severity="success">
              Your form answers were saved.
            </Alert>
          ) : null}
          <Stack
            component="form"
            className={styles.stepForm}
            onSubmit={(event) => {
              event.preventDefault()
              void advance(event.currentTarget)
            }}
            spacing={2}
          >
            {fields[step].map(({ key, label, type }) => (
              <TextField
                key={key}
                disabled={isSaving}
                label={label}
                name={key}
                onChange={(event) => updateAnswer(key, event.target.value)}
                required
                type={type}
                value={typeof answers[key] === 'string' ? answers[key] : ''}
              />
            ))}
            {step === 'personal-details' ? (
              <label>
                <input
                  checked={answers.consentConfirmed === true}
                  disabled={isSaving}
                  name="consentConfirmed"
                  onChange={(event) =>
                    updateAnswer('consentConfirmed', event.target.checked)
                  }
                  required
                  type="checkbox"
                />{' '}
                I confirm these details are accurate and belong to me.
              </label>
            ) : (
              <>
                <label htmlFor="document-evidence">
                  {currentForm.data.attributes.documentEvidence.present
                    ? 'Document evidence (already on file)'
                    : 'Document evidence (required)'}
                </label>
                <input
                  id="document-evidence"
                  ref={evidenceInput}
                  type="file"
                  accept="image/jpeg,image/png"
                  disabled={isSaving}
                  required={
                    !currentForm.data.attributes.documentEvidence.present
                  }
                  onChange={(event) => {
                    setEvidenceFile(event.currentTarget.files?.[0])
                    setSaved(false)
                    setError(undefined)
                    setSessionExpired(false)
                  }}
                />
              </>
            )}
            <Stack
              component="div"
              className={styles.formActions}
              direction="row"
              spacing={2}
            >
              <Button
                type="button"
                variant="quiet"
                disabled={isSaving}
                onPress={() =>
                  step === 'personal-details'
                    ? void navigate('/applications/current')
                    : void navigate(
                        `/applications/${applicationId}/personal-details`,
                      )
                }
              >
                Back
              </Button>
              <Button
                disabled={isSaving}
                onPress={() => void saveDraft()}
                type="button"
                variant="secondary"
              >
                {isSaving ? 'Saving...' : 'Save draft'}
              </Button>
              <Button disabled={isSaving} type="submit">
                {isSaving ? 'Saving...' : continueLabel}
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </Box>
    </main>
  )
}

function isApplicationStep(step: string): step is ApplicantApplicationStep {
  return step === 'personal-details' || step === 'identity-and-address'
}

function saveErrorMessage(error: unknown): string {
  if (!(error instanceof ApplicantApplicationApiError)) {
    return 'Your draft could not be saved. Check your connection and try again.'
  }
  if (error.status === 401) {
    return 'Your session has expired. Sign in again before saving this draft.'
  }
  if (error.status === 403) {
    return 'Your draft could not be saved. Refresh the page and sign in again if needed.'
  }
  if (error.status === 404) {
    return 'This application draft could not be found.'
  }
  if (error.status === 409) {
    return 'This draft changed elsewhere. Your edits are still here; reload the saved draft before trying again.'
  }
  if (error.status === 422) {
    return error.message
  }
  if (error.status === 0) return error.message
  return 'Your draft could not be saved. Please try again.'
}

function evidenceUploadErrorMessage(error: unknown): string {
  let detail = 'Check your connection and try again.'
  if (error instanceof ApplicantApplicationApiError) {
    detail =
      error.status === 401
        ? 'Your session has expired. Sign in again to upload the document.'
        : error.message
  }
  return `Your form answers were saved, but the document upload failed. ${detail}`
}
