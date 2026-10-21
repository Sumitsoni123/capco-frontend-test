import {
  Alert,
  Button,
  Card,
  CardContent,
  Link,
  Stack,
  TextField,
  Typography,
} from '@kyc/ui'
import { useEffect, useRef, useState } from 'react'

import { accountAccessHref, isSafeJourneyPath } from './-return-target'
import styles from './account-access.module.css'

export interface SignInFormProps {
  onNavigate?: (href: string) => void
  returnTo?: string
  onSuccess: (href: string) => void
}

type SignInFailure =
  | {
      kind: 'validation'
      emailError?: string
      passwordError?: string
      formError?: string
    }
  | { kind: 'invalid-credentials' }
  | { kind: 'rate-limited'; message: string; retryAfterSeconds?: number }
  | { kind: 'network' }
  | { kind: 'unexpected' }

type SignInResult =
  | { kind: 'success'; href: string }
  | { kind: 'failure'; failure: SignInFailure }

interface ApiError {
  pointer?: string
  detail?: string
}

async function signInApplicant(
  email: string,
  password: string,
): Promise<SignInResult> {
  let response: Response
  try {
    response = await fetch('/api/v1/applicant-sessions', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
      body: JSON.stringify({
        data: {
          type: 'applicant-sessions',
          attributes: { email, password },
        },
      }),
    })
  } catch {
    return { kind: 'failure', failure: { kind: 'network' } }
  }

  if (response.status === 201) {
    try {
      const payload: unknown = await response.json()
      if (!isRecord(payload) || !isRecord(payload.data)) {
        return { kind: 'failure', failure: { kind: 'unexpected' } }
      }
      const data = payload.data
      if (
        data.type !== 'applicant-sessions' ||
        !isRecord(data.attributes) ||
        typeof data.attributes.href !== 'string'
      ) {
        return { kind: 'failure', failure: { kind: 'unexpected' } }
      }
      return { kind: 'success', href: data.attributes.href }
    } catch {
      return { kind: 'failure', failure: { kind: 'unexpected' } }
    }
  }
  if (response.status === 400) {
    return {
      kind: 'failure',
      failure: await readValidationFailure(response),
    }
  }
  if (response.status === 401) {
    return { kind: 'failure', failure: { kind: 'invalid-credentials' } }
  }
  if (response.status === 429) {
    const errors = await readApiErrors(response)
    const retryAfter = Number(response.headers.get('Retry-After'))
    return {
      kind: 'failure',
      failure: {
        kind: 'rate-limited',
        message:
          errors.find((apiError) => apiError.detail)?.detail ??
          'Too many attempts. Try again later.',
        retryAfterSeconds:
          Number.isInteger(retryAfter) && retryAfter > 0
            ? retryAfter
            : undefined,
      },
    }
  }

  return { kind: 'failure', failure: { kind: 'unexpected' } }
}

async function readValidationFailure(
  response: Response,
): Promise<Extract<SignInFailure, { kind: 'validation' }>> {
  const errors = await readApiErrors(response)
  const emailErrors: string[] = []
  const passwordErrors: string[] = []
  const formErrors: string[] = []

  for (const apiError of errors) {
    const detail = apiError.detail ?? 'Check this value and try again.'
    if (apiError.pointer === '/data/attributes/email') {
      emailErrors.push(detail)
    } else if (apiError.pointer === '/data/attributes/password') {
      passwordErrors.push(detail)
    } else {
      formErrors.push(detail)
    }
  }

  if (errors.length === 0) {
    formErrors.push('The sign-in details could not be validated.')
  }

  return {
    kind: 'validation',
    emailError: emailErrors.length ? emailErrors.join(' ') : undefined,
    passwordError: passwordErrors.length ? passwordErrors.join(' ') : undefined,
    formError: formErrors.length ? formErrors.join(' ') : undefined,
  }
}

async function readApiErrors(response: Response): Promise<ApiError[]> {
  try {
    const payload: unknown = await response.json()
    if (!isRecord(payload) || !Array.isArray(payload.errors)) return []

    return payload.errors.flatMap((error): ApiError[] => {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function SignInForm({
  onNavigate,
  returnTo,
  onSuccess,
}: SignInFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [emailError, setEmailError] = useState<string>()
  const [passwordError, setPasswordError] = useState<string>()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSubmittingRef = useRef(false)
  const emailInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (emailError) {
      emailInput.current?.focus()
    } else if (passwordError) {
      passwordInput.current?.focus()
    }
  }, [emailError, passwordError])

  async function submit(): Promise<void> {
    if (isSubmittingRef.current) return

    setError(undefined)
    setEmailError(undefined)
    setPasswordError(undefined)

    const validationErrors: string[] = []
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email.trim())) {
      setEmailError('Enter a valid email address.')
      validationErrors.push('email')
    }
    if (!password) {
      setPasswordError('Enter your password.')
      validationErrors.push('password')
    }
    if (validationErrors.length > 0) return

    isSubmittingRef.current = true
    setIsSubmitting(true)
    let result: SignInResult
    try {
      result = await signInApplicant(email.trim(), password)
    } finally {
      isSubmittingRef.current = false
      setIsSubmitting(false)
    }

    if (result.kind === 'success') {
      if (!isSafeJourneyPath(result.href)) {
        setError('We could not sign you in. Please try again.')
        return
      }
      onSuccess(result.href)
      return
    }

    const { failure } = result
    if (failure.kind === 'validation') {
      setEmailError(failure.emailError)
      setPasswordError(failure.passwordError)
      setError(failure.formError)
    } else if (failure.kind === 'invalid-credentials') {
      setError('Invalid email or password.')
    } else if (failure.kind === 'rate-limited') {
      setError(
        failure.retryAfterSeconds
          ? `${failure.message} You can try again in ${failure.retryAfterSeconds} seconds.`
          : failure.message,
      )
    } else if (failure.kind === 'network') {
      setError(
        'Unable to reach the service. Check your connection and try again.',
      )
    } else {
      setError('We could not sign you in. Please try again.')
    }
  }

  return (
    <main className={styles.page}>
      <Card className={styles.card}>
        <CardContent className={styles.cardContent}>
          <Stack
            component="form"
            className={styles.form}
            aria-busy={isSubmitting}
            onSubmit={(event) => {
              event.preventDefault()
              if (!isSubmitting) void submit()
            }}
            spacing={3}
          >
            <Stack spacing={1}>
              <Typography component="h1" variant="heading">
                Welcome back
              </Typography>
              <Typography tone="muted">
                Sign in to continue your KYC application.
              </Typography>
            </Stack>
            {isSubmitting ? (
              <Alert aria-live="polite" role="status" severity="info">
                Signing in...
              </Alert>
            ) : null}
            {error ? (
              <Alert aria-live="assertive" role="alert" severity="error">
                {error}
              </Alert>
            ) : null}
            <TextField
              autoComplete="email"
              error={Boolean(emailError)}
              fullWidth
              helperText={emailError}
              id="applicant-email"
              inputRef={emailInput}
              label="Email address"
              name="email"
              onChange={(event) => {
                setEmail(event.target.value)
                setEmailError(undefined)
                setError(undefined)
              }}
              disabled={isSubmitting}
              required
              type="email"
              value={email}
            />
            <TextField
              autoComplete="current-password"
              error={Boolean(passwordError)}
              fullWidth
              helperText={passwordError}
              id="applicant-password"
              inputRef={passwordInput}
              label="Password"
              name="password"
              onChange={(event) => {
                setPassword(event.target.value)
                setPasswordError(undefined)
                setError(undefined)
              }}
              disabled={isSubmitting}
              required
              type="password"
              value={password}
            />
            <Button
              className={styles.submit}
              disabled={isSubmitting}
              fullWidth
              size="large"
              type="submit"
            >
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </Button>
            <Typography
              className={styles.footer}
              align="center"
              variant="caption"
            >
              <span>New to KYC? </span>
              <Link
                href={accountAccessHref('/create-account', returnTo)}
                onClick={(event) => {
                  if (onNavigate) {
                    event.preventDefault()
                    onNavigate(accountAccessHref('/create-account', returnTo))
                  }
                }}
              >
                Create account
              </Link>
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </main>
  )
}
