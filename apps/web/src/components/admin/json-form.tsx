'use client';

import { useActionState, useState } from 'react';
import type { FormState } from '@/app/admin/actions';
import { Textarea } from '@/components/ui/textarea';
import { SubmitButton } from './submit-button';

export function FormErrors({ state }: { state: FormState }) {
  if (!state.error && !state.message) return null;
  if (!state.error)
    return (
      <p role="status" className="text-sm text-live-foreground">
        {state.message}
      </p>
    );
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <p className="font-medium">{state.error}</p>
      {state.issues && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 font-mono text-xs">
          {state.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Generic "edit JSON, validate on the server, save" form. The text is controlled so errors never lose it. */
export function JsonForm({
  action,
  id,
  initial,
  submitLabel,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  id: string | number;
  initial: string;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const [text, setText] = useState(initial);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <Textarea
        name="payload"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-invalid={!!state.error}
        className="min-h-80 font-mono text-xs"
      />
      <FormErrors state={state} />
      <SubmitButton pendingText="保存中…">{submitLabel}</SubmitButton>
    </form>
  );
}
