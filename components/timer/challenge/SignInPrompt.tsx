'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Button, Card, Note } from './ui';

/** Shown on /timer/challenge/** when nobody is signed in. */
export default function SignInPrompt() {
  const { signInWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="Нэвтрэх шаардлагатай" testId="challenge-signin">
      <Note text="Challenge ашиглахын тулд timer-ийн Google бүртгэлээрээ нэвтэрнэ үү." />
      <div>
        <Button onClick={async () => {
          setError(null);
          try { await signInWithGoogle(); } catch { setError('Нэвтэрч чадсангүй. Дахин оролдоно уу.'); }
        }}>Google-ээр нэвтрэх</Button>
      </div>
      {error && <Note text={error} tone="danger" />}
    </Card>
  );
}
