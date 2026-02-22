import { SignOutButton, UserProfile } from '@clerk/nextjs'
import Link from 'next/link'

export default function ProfilePage() {
  return (
    <main style={{ padding: '1rem' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h1>Profile</h1>
        <Link href="/dashboard">Back to Dashboard</Link>
      </header>

      <section style={{ marginBottom: '1rem' }}>
        <SignOutButton redirectUrl="/">
          <button type="button">Sign out</button>
        </SignOutButton>
      </section>

      <UserProfile
        routing="path"
        path="/profile"
      />
    </main>
  )
}
