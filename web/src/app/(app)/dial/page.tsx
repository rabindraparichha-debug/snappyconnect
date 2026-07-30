'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { DialerPanel } from '@/components/DialerPanel';
import { Card, Spinner } from '@/components/ui';

function DialContent() {
  const params = useSearchParams();
  const number = params.get('number') ?? '';
  // Click-to-call opens this page with `autodial=1` so the recruiter's single
  // click on the source page is the whole action, not the first half of one.
  const autoDial = number !== '' && params.get('autodial') === '1';

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-2xl font-bold text-slate-900">Dialer</h1>
      <p className="mt-1 text-sm text-slate-500">
        {number ? 'Number pre-filled from click-to-call.' : 'Enter a number to place a call.'}
      </p>
      <Card className="mt-6 p-6">
        <DialerPanel initialNumber={number} autoDial={autoDial} />
      </Card>
    </div>
  );
}

export default function DialPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-24">
          <Spinner className="h-8 w-8" />
        </div>
      }
    >
      <DialContent />
    </Suspense>
  );
}
