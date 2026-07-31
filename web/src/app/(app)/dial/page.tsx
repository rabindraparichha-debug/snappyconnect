'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { DialerPanel } from '@/components/DialerPanel';
import { Card, Spinner } from '@/components/ui';

function DialContent() {
  const params = useSearchParams();
  const number = params.get('number') ?? '';

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-2xl font-bold text-slate-900">Dialer</h1>
      <p className="mt-1 text-sm text-slate-500">
        {number ? 'Number pre-filled from click-to-call.' : 'Enter a number to place a call.'}
      </p>
      <Card className="mt-6 p-6">
        <DialerPanel initialNumber={number} />
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
