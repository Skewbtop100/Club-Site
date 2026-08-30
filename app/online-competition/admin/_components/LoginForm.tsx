'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, FieldLabel, INPUT_CLASS } from '../../_components/ui';

export default function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/online-competition/admin-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'Нэвтрэхэд алдаа гарлаа');
        return;
      }
      // Cookie is now set — re-run the server component so it renders
      // the dashboard instead of this form.
      router.refresh();
    } catch {
      setError('Сүлжээний алдаа гарлаа');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full"
      style={{ border: '1px solid #DCD6C8', borderRadius: 2, background: '#FFFDF8', padding: 24 }}
    >
      <FieldLabel>Нууц үг</FieldLabel>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={INPUT_CLASS}
        style={{ marginTop: 8 }}
        autoFocus
      />
      {error && (
        <p className="text-sm text-[#D8402C]" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
      <Button
        type="submit"
        variant="primary-dark"
        disabled={loading || !password}
        style={{ marginTop: 16 }}
      >
        Нэвтрэх
      </Button>
    </form>
  );
}
