import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'

import { server } from '../test/server'

import { CreateAccountForm } from './-create-account-form'

const registrationUrl = '/api/v1/applicant-accounts'
const validEmail = 'applicant@example.com'
const validPassword = 'Secure!1'

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email address'), validEmail)
  await user.type(screen.getByLabelText('Password'), validPassword)
  await user.type(screen.getByLabelText('Confirm password'), validPassword)
}

describe('CreateAccountForm', () => {
  it('validates email before making a registration request', async () => {
    const user = userEvent.setup()
    const registrationRequest = vi.fn(
      () => new HttpResponse(null, { status: 201 }),
    )
    server.use(http.post(registrationUrl, registrationRequest))
    render(<CreateAccountForm />)

    await user.type(screen.getByLabelText('Email address'), 'not-an-email')
    await user.type(screen.getByLabelText('Password'), validPassword)
    await user.type(screen.getByLabelText('Confirm password'), validPassword)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument()
    expect(registrationRequest).not.toHaveBeenCalled()
  })

  it('validates the password policy and confirmation before making a request', async () => {
    const user = userEvent.setup()
    const registrationRequest = vi.fn(
      () => new HttpResponse(null, { status: 201 }),
    )
    server.use(http.post(registrationUrl, registrationRequest))
    render(<CreateAccountForm />)

    await user.type(screen.getByLabelText('Email address'), validEmail)
    await user.type(screen.getByLabelText('Password'), 'weakpass')
    await user.type(screen.getByLabelText('Confirm password'), 'weakpass')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(registrationRequest).not.toHaveBeenCalled()
  })

  it('reports mismatched password confirmation without making a request', async () => {
    const user = userEvent.setup()
    const registrationRequest = vi.fn(
      () => new HttpResponse(null, { status: 201 }),
    )
    server.use(http.post(registrationUrl, registrationRequest))
    render(<CreateAccountForm />)

    await user.type(screen.getByLabelText('Email address'), validEmail)
    await user.type(screen.getByLabelText('Password'), validPassword)
    await user.type(screen.getByLabelText('Confirm password'), 'Different!1')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.getByText('Passwords do not match.')).toHaveAttribute(
      'slot',
      'errorMessage',
    )
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(registrationRequest).not.toHaveBeenCalled()
  })

  it('accepts Unicode uppercase characters allowed by the API password policy', async () => {
    const user = userEvent.setup()
    const registrationRequest = vi.fn(
      () => new HttpResponse(null, { status: 201 }),
    )
    server.use(http.post(registrationUrl, registrationRequest))
    render(<CreateAccountForm />)

    await user.type(screen.getByLabelText('Email address'), validEmail)
    await user.type(screen.getByLabelText('Password'), '\u2160bcde!')
    await user.type(screen.getByLabelText('Confirm password'), '\u2160bcde!')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your account has been created.',
    )
    expect(registrationRequest).toHaveBeenCalledOnce()
  })

  it('submits the JSON:API document and offers sign-in after account creation', async () => {
    const user = userEvent.setup()
    const requests: Array<{
      method: string
      contentType: string | null
      body: unknown
    }> = []
    server.use(
      http.post(registrationUrl, async ({ request }) => {
        requests.push({
          method: request.method,
          contentType: request.headers.get('Content-Type'),
          body: await request.json(),
        })
        return new HttpResponse(null, { status: 201 })
      }),
    )
    const onNavigate = vi.fn()
    render(
      <CreateAccountForm
        onNavigate={onNavigate}
        returnTo="/applications/current"
      />,
    )
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your account has been created. You can now sign in.',
    )
    expect(requests).toEqual([
      {
        method: 'POST',
        contentType: 'application/vnd.api+json',
        body: {
          data: {
            type: 'applicant-accounts',
            attributes: { email: validEmail, password: validPassword },
          },
        },
      },
    ])

    const signInLink = screen.getByRole('link', { name: 'Sign in' })
    expect(signInLink).toHaveAttribute(
      'href',
      '/sign-in?returnTo=%2Fapplications%2Fcurrent',
    )
    await user.click(signInLink)
    expect(onNavigate).toHaveBeenCalledWith(
      '/sign-in?returnTo=%2Fapplications%2Fcurrent',
    )
    expect(screen.getByLabelText('Email address')).toHaveValue(validEmail)
  })

  it('maps API validation pointers to fields and preserves entered values', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(registrationUrl, () =>
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
                detail: 'Use the required password format.',
                source: { pointer: '/data/attributes/password' },
              },
            ],
          },
          { status: 400 },
        ),
      ),
    )
    render(<CreateAccountForm />)
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(
      await screen.findByText('Enter a valid email address.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Use the required password format.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toHaveValue(validEmail)
    expect(screen.getByLabelText('Password')).toHaveValue(validPassword)
    expect(screen.getByLabelText('Confirm password')).toHaveValue(validPassword)
  })

  it('shows a useful duplicate-email error and preserves values', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(registrationUrl, () =>
        HttpResponse.json(
          {
            errors: [
              {
                status: '409',
                code: 'email-already-registered',
                title: 'Account conflict',
                detail: 'An account already exists for this email address.',
              },
            ],
          },
          { status: 409 },
        ),
      ),
    )
    render(<CreateAccountForm />)
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An account already exists for this email address.',
    )
    expect(screen.getByLabelText('Email address')).toHaveValue(validEmail)
    expect(screen.getByLabelText('Password')).toHaveValue(validPassword)
  })

  it('shows the rate-limit message and retry delay', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(registrationUrl, () =>
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
          { status: 429, headers: { 'Retry-After': '8' } },
        ),
      ),
    )
    render(<CreateAccountForm />)
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again later. You can try again in 8 seconds.',
    )
  })

  it('distinguishes network failures from unexpected API responses', async () => {
    const user = userEvent.setup()
    server.use(http.post(registrationUrl, () => HttpResponse.error()))
    render(<CreateAccountForm />)
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to reach the service.',
    )
  })

  it('shows an unexpected response error', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(registrationUrl, () => new HttpResponse(null, { status: 500 })),
    )
    render(<CreateAccountForm />)
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not create your account. Please try again.',
    )
  })

  it('releases the submit state after an unexpected request error', async () => {
    const user = userEvent.setup()
    const brokenResponse = new Proxy(new Response(), {
      get(target, property, receiver) {
        if (property === 'status') {
          throw new Error('Unexpected response failure')
        }
        return Reflect.get(target, property, receiver)
      },
    })
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(brokenResponse)
    render(<CreateAccountForm />)
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not create your account. Please try again.',
    )
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled()
    fetchSpy.mockRestore()
  })

  it('prevents duplicate submissions while the request is pending', async () => {
    const user = userEvent.setup()
    let releaseResponse: () => void = () => undefined
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve
    })
    const registrationRequest = vi.fn(async () => {
      await responseGate
      return new HttpResponse(null, { status: 201 })
    })
    server.use(http.post(registrationUrl, registrationRequest))
    render(<CreateAccountForm />)
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: 'Create account' }))
    const submitButton = screen.getByRole('button', {
      name: 'Creating account...',
    })
    await waitFor(() => expect(registrationRequest).toHaveBeenCalledTimes(1))
    expect(submitButton).toBeDisabled()
    await user.click(submitButton)
    expect(registrationRequest).toHaveBeenCalledTimes(1)

    releaseResponse()
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Your account has been created.',
    )
  })
})
