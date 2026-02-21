import { auth, currentUser } from '@clerk/nextjs/server'
import { UserButton } from '@clerk/nextjs'

export default async function DashboardPage() {
  const { userId } = await auth()
  const user = await currentUser()

  return (
    <main>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem' }}>
        <h1>Dashboard</h1>
        <UserButton afterSignOutUrl="/" />
      </header>
      <section style={{ padding: '1rem' }}>
        <p>Welcome, {user?.firstName ?? 'User'}!</p>
        <p>Clerk ID: {userId}</p>
      </section>
    </main>
  )
}
