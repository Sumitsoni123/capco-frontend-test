import { Alert, Stack } from '@kyc/ui'
import { useState } from 'react'
import { redirect, useNavigate } from 'react-router'

import { accountAccessHref, isSafeJourneyPath } from '../-return-target'
import {
  ApplicantApplicationApiError,
  createOrGetApplicantApplication,
  getCurrentApplicantApplication,
  type ApplicantApplicationProgress,
} from '../../api/applicant-applications'

import {
  ApplicantJourneyPresentation,
  type ApplicantJourneyPresentationFixture,
} from './-applicant-journey-presentation'

import type { Route } from './+types/current'

type JourneyLoaderData =
  | { kind: 'empty' }
  | {
      kind: 'draft'
      href: string
      progress: ApplicantApplicationProgress[]
    }
  | { kind: 'error'; message: string }

export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<JourneyLoaderData | Response> {
  try {
    const application = await getCurrentApplicantApplication()
    if (!application) return { kind: 'empty' }
    return {
      kind: 'draft',
      href: application.data.attributes.href,
      progress: application.data.attributes.progress,
    }
  } catch (error) {
    if (error instanceof ApplicantApplicationApiError && error.status === 401) {
      const url = new URL(request.url)
      throw redirect(
        accountAccessHref('/sign-in', `${url.pathname}${url.search}`),
      )
    }
    return {
      kind: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Your application could not be loaded. Please try again.',
    }
  }
}

export default function CurrentApplicationJourneyPage({
  loaderData,
}: Route.ComponentProps) {
  const navigate = useNavigate()
  const [actionError, setActionError] = useState<string>()

  if (loaderData.kind === 'error') {
    return (
      <main>
        <Alert severity="error">{loaderData.message}</Alert>
      </main>
    )
  }

  const fixture = journeyFixture(loaderData)

  async function startOrResume(): Promise<void> {
    setActionError(undefined)
    try {
      const href =
        loaderData.kind === 'draft'
          ? loaderData.href
          : (await createOrGetApplicantApplication()).data.attributes.href
      if (!isSafeJourneyPath(href)) {
        setActionError(
          'Your application could not be opened. Please try again.',
        )
        return
      }
      void navigate(href)
    } catch (error) {
      if (
        error instanceof ApplicantApplicationApiError &&
        error.status === 401
      ) {
        void navigate(accountAccessHref('/sign-in', '/applications/current'))
        return
      }
      setActionError(
        error instanceof Error
          ? error.message
          : 'Your application could not be started. Please try again.',
      )
    }
  }

  return (
    <Stack spacing={2}>
      {actionError ? <Alert severity="error">{actionError}</Alert> : null}
      <ApplicantJourneyPresentation
        {...fixture}
        onPrimaryAction={() => void startOrResume()}
      />
    </Stack>
  )
}

function journeyFixture(
  loaderData: Exclude<JourneyLoaderData, { kind: 'error' }>,
): ApplicantJourneyPresentationFixture {
  if (loaderData.kind === 'draft') {
    return {
      entryState: 'resume',
      progress: loaderData.progress.map(({ step, state }) => ({
        step,
        state: state === 'not-started' ? 'remaining' : state,
      })),
    }
  }

  return {
    entryState: 'start',
    progress: [
      { step: 'personal-details', state: 'current' },
      { step: 'identity-and-address', state: 'remaining' },
    ],
  }
}
