import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'

import { server } from '../test/server'

import { SignInForm } from './-sign-in-form'

const signInUrl = '/api/v1/applicant-sessions'
const validEmail = 'applicant@example.com'
const validPassword = 'Secure!1'

async function fillCredentials(
  user: ReturnType<typeof userEvent.setup>,
  email = validEmail,
  password = validPassword,
) {
  await user.type(screen.getByLabelText('Email address'), email)
  await user.type(screen.getByLabelText('Password'), password)
}

function renderSignIn(onSuccess = vi.fn()) {
  return {
    onSuccess,
    ...render(<SignInForm onSuccess={onSuccess} />),
  }
}

describe('SignInForm', () => {
  it('requires a valid email and password before making a request', async () => {
    const user = userEvent.setup()
    const signInRequest = vi.fn(() => new HttpResponse(null, { status: 401 }))
    server.use(http.post(signInUrl, signInRequest))
    renderSignIn()

    await user.type(screen.getByLabelText('Email address'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(screen.getByLabelText('Email address')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(signInRequest).not.toHaveBeenCalled()
  })

  it('submits JSON:API credentials and navigates to the returned journey href', async () => {
    const user = userEvent.setup()
    const requests: Array<{
      method: string
      credentials: RequestCredentials
      contentType: string | null
      body: unknown
    }> = []
    server.use(
      http.post(signInUrl, async ({ request }) => {
        requests.push({
          method: request.method,
          credentials: request.credentials,
          contentType: request.headers.get('Content-Type'),
          body: await request.json(),
        })
        return HttpResponse.json(
          {
            data: {
              type: 'applicant-sessions',
              id: 'f59c67d2-18c0-4bfc-b7c0-09de844dbb87',
              attributes: { href: '/applications/draft-123/personal-details' },
            },
          },
          {
            status: 201,
            headers: { 'Set-Cookie': 'session=opaque; HttpOnly' },
          },
        )
      }),
    )
    const onSuccess = vi.fn()
    render(
      <SignInForm
        onSuccess={onSuccess}
        returnTo="/applications/return-target/personal-details"
      />,
    )
    await fillCredentials(user)

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith(
        '/applications/draft-123/personal-details',
      ),
    )
    expect(requests).toEqual([
      {
        method: 'POST',
        credentials: 'same-origin',
        contentType: 'application/vnd.api+json',
        body: {
          data: {
            type: 'applicant-sessions',
            attributes: { email: validEmail, password: validPassword },
          },
        },
      },
    ])
  })

  it('shows a generic invalid-credentials error and preserves the email', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(signInUrl, () =>
        HttpResponse.json(
          {
            errors: [
              {
                status: '401',
                code: 'invalid-credentials',
                title: 'Authentication failed',
                detail: 'Invalid email or password',
              },
            ],
          },
          { status: 401 },
        ),
      ),
    )
    renderSignIn()
    await fillCredentials(user)

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid email or password.',
    )
    expect(screen.getByLabelText('Email address')).toHaveValue(validEmail)
    expect(screen.queryByText(/email address is registered/i)).toBeNull()
  })

  it('maps malformed-input validation pointers to the relevant fields', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(signInUrl, () =>
        HttpResponse.json(
          {
            errors: [
              {
                status: '400',
                code: 'validation-failed',
                title: 'Invalid attribute',
                detail: 'Enter a valid email address.',
                source: { pointer: '/data/attributes/email' },
              },
              {
                status: '400',
                code: 'validation-failed',
                title: 'Invalid attribute',
                detail: 'Enter a password.',
                source: { pointer: '/data/attributes/password' },
              },
            ],
          },
          { status: 400 },
        ),
      ),
    )
    renderSignIn()
    await fillCredentials(user)

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(screen.getByLabelText('Email address')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByText('Enter a password.')).toHaveAttribute(
      'slot',
      'errorMessage',
    )
    expect(screen.getByLabelText('Email address')).toHaveValue(validEmail)
  })

  it('shows the rate-limit detail and retry delay', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(signInUrl, () =>
        HttpResponse.json(
          {
            errors: [
              {
                status: '429',
                code: 'rate-limited',
                title: 'Too many requests',
                detail: 'Too many attempts. Try again later.',
              },
            ],
          },
          { status: 429, headers: { 'Retry-After': '12' } },
        ),
      ),
    )
    renderSignIn()
    await fillCredentials(user)

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again later. You can try again in 12 seconds.',
    )
    expect(screen.getByLabelText('Email address')).toHaveValue(validEmail)
  })

  it('shows a network error and preserves the entered email', async () => {
    const user = userEvent.setup()
    server.use(http.post(signInUrl, () => HttpResponse.error()))
    renderSignIn()
    await fillCredentials(user)

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to reach the service.',
    )
    expect(screen.getByLabelText('Email address')).toHaveValue(validEmail)
  })

  it.each([
    [
      'an unexpected server response',
      () => new HttpResponse(null, { status: 500 }),
    ],
    [
      'a malformed success response',
      () => HttpResponse.json({}, { status: 201 }),
    ],
    [
      'an unsafe journey URL',
      () =>
        HttpResponse.json(
          {
            data: {
              type: 'applicant-sessions',
              id: 'f59c67d2-18c0-4bfc-b7c0-09de844dbb87',
              attributes: { href: 'https://example.com/' },
            },
          },
          { status: 201 },
        ),
    ],
  ])('shows a form-level error for %s', async (_description, response) => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    server.use(http.post(signInUrl, response))
    renderSignIn(onSuccess)
    await fillCredentials(user)

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not sign you in. Please try again.',
    )
    expect(onSuccess).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Email address')).toHaveValue(validEmail)
  })

  it('announces pending status and prevents duplicate submissions', async () => {
    const user = userEvent.setup()
    let releaseResponse: () => void = () => undefined
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    const signInRequest = vi.fn(async () => {
      await responseGate
      return HttpResponse.json(
        {
          data: {
            type: 'applicant-sessions',
            id: 'f59c67d2-18c0-4bfc-b7c0-09de844dbb87',
            attributes: { href: '/applications/draft-123/personal-details' },
          },
        },
        { status: 201 },
      )
    })
    server.use(http.post(signInUrl, signInRequest))
    const { container, onSuccess } = renderSignIn()
    await fillCredentials(user)

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Signing in...')
    const submitButton = screen.getByRole('button', { name: 'Signing in...' })
    expect(submitButton).toBeDisabled()
    expect(container.querySelector('form')).toHaveAttribute('aria-busy', 'true')
    await user.click(submitButton)
    expect(signInRequest).toHaveBeenCalledOnce()

    releaseResponse()
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
  })
})
