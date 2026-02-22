import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs'
import Link from 'next/link'

export default function Home() {
  return (
    <main>
      <h1>Hestia</h1>
      <p>Home inventory &amp; maintenance management</p>
      <SignedOut>
        <SignInButton mode="redirect" />
        <SignUpButton mode="redirect" />
      </SignedOut>
      <SignedIn>
        <UserButton />
        <Link href="/dashboard">Go to Dashboard</Link>
      </SignedIn>
    </main>
  )
}
