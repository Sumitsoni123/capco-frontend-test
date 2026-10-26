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

import { readJsonApiErrors } from '../api/json-api-errors'

import { accountAccessHref } from './-return-target'
import styles from './account-access.module.css'

export interface CreateAccountFormProps {
  onNavigate?: (href: string) => void
  returnTo?: string
}

const passwordGuidance =
  'Use at least six characters, including one uppercase letter and one special character.'

type RegistrationFailure =
  | {
      kind: 'validation'
      emailError?: string
      passwordError?: string
      confirmationError?: string
      formError?: string
    }
  | { kind: 'duplicate' }
  | { kind: 'rate-limited'; message: string; retryAfterSeconds?: number }
  | { kind: 'network' }
  | { kind: 'unexpected' }

type RegistrationResult =
  { kind: 'success' } | { kind: 'failure'; failure: RegistrationFailure }

async function registerApplicant(
  email: string,
  password: string,
): Promise<RegistrationResult> {
  let response: Response
  try {
    response = await fetch('/api/v1/applicant-accounts', {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
      body: JSON.stringify({
        data: {
          type: 'applicant-accounts',
          attributes: { email, password },
        },
      }),
    })
  } catch {
    return { kind: 'failure', failure: { kind: 'network' } }
  }

  if (response.status === 201) return { kind: 'success' }
  if (response.status === 400) {
    return {
      kind: 'failure',
      failure: await readValidationFailure(response),
    }
  }
  if (response.status === 409) {
    return { kind: 'failure', failure: { kind: 'duplicate' } }
  }
  if (response.status === 429) {
    const errors = await readJsonApiErrors(response)
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
): Promise<Extract<RegistrationFailure, { kind: 'validation' }>> {
  const errors = await readJsonApiErrors(response)
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
    formErrors.push('The registration details could not be validated.')
  }

  return {
    kind: 'validation',
    emailError: emailErrors.length ? emailErrors.join(' ') : undefined,
    passwordError: passwordErrors.length ? passwordErrors.join(' ') : undefined,
    formError: formErrors.length ? formErrors.join(' ') : undefined,
  }
}

function validateRegistration(
  email: string,
  password: string,
  passwordConfirmation: string,
): Pick<
  Extract<RegistrationFailure, { kind: 'validation' }>,
  'emailError' | 'passwordError' | 'confirmationError'
> {
  const errors: {
    emailError?: string
    passwordError?: string
    confirmationError?: string
  } = {}

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email.trim())) {
    errors.emailError = 'Enter a valid email address.'
  }

  const hasUppercase = Array.from(password).some((character) =>
    /\p{Uppercase}/u.test(character),
  )
  const hasSpecialCharacter = Array.from(password).some(
    (character) => !/[\p{L}\p{Nd}]/u.test(character),
  )
  if (password.length < 6 || !hasUppercase || !hasSpecialCharacter) {
    errors.passwordError = passwordGuidance
  } else if (password !== passwordConfirmation) {
    errors.confirmationError = 'Passwords do not match.'
  }

  return errors
}

export function CreateAccountForm({
  onNavigate,
  returnTo,
}: CreateAccountFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [formError, setFormError] = useState<string>()
  const [emailError, setEmailError] = useState<string>()
  const [passwordError, setPasswordError] = useState<string>()
  const [confirmationError, setConfirmationError] = useState<string>()
  const [successMessage, setSuccessMessage] = useState<string>()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const emailInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)
  const confirmationInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (emailError) {
      emailInput.current?.focus()
    } else if (passwordError) {
      passwordInput.current?.focus()
    } else if (confirmationError) {
      confirmationInput.current?.focus()
    }
  }, [emailError, passwordError, confirmationError])

  async function submit(): Promise<void> {
    setFormError(undefined)
    setEmailError(undefined)
    setPasswordError(undefined)
    setConfirmationError(undefined)
    setSuccessMessage(undefined)

    const validation = validateRegistration(
      email,
      password,
      passwordConfirmation,
    )
    if (Object.keys(validation).length > 0) {
      setEmailError(validation.emailError)
      setPasswordError(validation.passwordError)
      setConfirmationError(validation.confirmationError)
      return
    }

    setIsSubmitting(true)
    let result: RegistrationResult
    try {
      result = await registerApplicant(email.trim(), password)
    } catch {
      setFormError('We could not create your account. Please try again.')
      return
    } finally {
      setIsSubmitting(false)
    }

    if (result.kind === 'success') {
      setPassword('')
      setPasswordConfirmation('')
      setSuccessMessage('Your account has been created. You can now sign in.')
      return
    }

    const { failure } = result
    if (failure.kind === 'validation') {
      setEmailError(failure.emailError)
      setPasswordError(failure.passwordError)
      setConfirmationError(failure.confirmationError)
      setFormError(failure.formError)
    } else if (failure.kind === 'duplicate') {
      setFormError('An account already exists for this email address.')
    } else if (failure.kind === 'rate-limited') {
      setFormError(
        failure.retryAfterSeconds
          ? `${failure.message} You can try again in ${failure.retryAfterSeconds} seconds.`
          : failure.message,
      )
    } else if (failure.kind === 'network') {
      setFormError(
        'Unable to reach the service. Check your connection and try again.',
      )
    } else {
      setFormError('We could not create your account. Please try again.')
    }
  }

  return (
    <main className={styles.page}>
      <Card className={styles.card}>
        <CardContent className={styles.cardContent}>
          <Stack
            component="form"
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault()
              if (!isSubmitting) void submit()
            }}
            spacing={3}
          >
            <Stack spacing={1}>
              <Typography component="h1" variant="heading">
                Create your account
              </Typography>
              <Typography tone="muted">
                Create credentials to begin your KYC application.
              </Typography>
            </Stack>
            {formError ? (
              <Alert aria-live="assertive" role="alert" severity="error">
                {formError}
              </Alert>
            ) : null}
            {successMessage ? (
              <Alert aria-live="polite" role="status" severity="success">
                {successMessage}
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
              }}
              disabled={isSubmitting || Boolean(successMessage)}
              required
              type="email"
              value={email}
            />
            <TextField
              autoComplete="new-password"
              error={Boolean(passwordError)}
              fullWidth
              helperText={passwordError ?? passwordGuidance}
              id="applicant-password"
              inputRef={passwordInput}
              label="Password"
              name="password"
              onChange={(event) => {
                setPassword(event.target.value)
                setPasswordError(undefined)
                setConfirmationError(undefined)
              }}
              disabled={isSubmitting || Boolean(successMessage)}
              required
              type="password"
              value={password}
            />
            <TextField
              autoComplete="new-password"
              error={Boolean(confirmationError)}
              fullWidth
              helperText={confirmationError}
              id="applicant-password-confirmation"
              inputRef={confirmationInput}
              label="Confirm password"
              name="passwordConfirmation"
              onChange={(event) => {
                setPasswordConfirmation(event.target.value)
                setConfirmationError(undefined)
              }}
              disabled={isSubmitting || Boolean(successMessage)}
              required
              type="password"
              value={passwordConfirmation}
            />
            <Button
              className={styles.submit}
              disabled={isSubmitting || Boolean(successMessage)}
              fullWidth
              size="large"
              type="submit"
            >
              {isSubmitting ? 'Creating account...' : 'Create account'}
            </Button>
            <Typography
              className={styles.footer}
              align="center"
              variant="caption"
            >
              <span>
                {successMessage ? 'Continue to ' : 'Already have an account? '}
              </span>
              <Link
                href={accountAccessHref('/sign-in', returnTo)}
                onClick={(event) => {
                  if (onNavigate) {
                    event.preventDefault()
                    onNavigate(accountAccessHref('/sign-in', returnTo))
                  }
                }}
              >
                Sign in
              </Link>
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </main>
  )
}
