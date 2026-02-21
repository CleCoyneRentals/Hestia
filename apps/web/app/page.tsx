import { SignedIn, SignedOut, UserButton } from "@neondatabase/auth/react";

export default function Home() {
  return (
    <main>
      <SignedOut>
        <a href="/auth/sign-in">Sign In</a>
      </SignedOut>
      <SignedIn>
        <UserButton />
      </SignedIn>
    </main>
  );
}
