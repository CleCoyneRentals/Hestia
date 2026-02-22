import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
  return (
    <main style={{ display: 'flex', justifyContent: 'center', marginTop: '5rem' }}>
      <SignUp />
    </main>
  )
}
