'use client';

import { useActionState, useState } from 'react';
import { approveAction, rejectAction, resolveFlagAction } from '@/app/admin/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FormErrors } from './json-form';
import { SubmitButton } from './submit-button';

function RejectDialog({
  id,
  label = '拒绝',
  decision,
}: {
  id: number;
  label?: string;
  decision?: 'dismiss';
}) {
  const [state, formAction] = useActionState(decision ? resolveFlagAction : rejectAction, {});
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="destructive" />}>{label}</DialogTrigger>
      <DialogContent>
        <form action={formAction} className="grid gap-4">
          <input type="hidden" name="id" value={id} />
          {decision && <input type="hidden" name="decision" value={decision} />}
          <DialogHeader>
            <DialogTitle>确认{label}？</DialogTitle>
            <DialogDescription>该提案将被标记为已拒绝，不会修改任何已发布数据。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={`reject-note-${id}`}>理由（可选）</Label>
            <Textarea id={`reject-note-${id}`} name="note" className="min-h-20" />
          </div>
          <FormErrors state={state} />
          <DialogFooter>
            <SubmitButton variant="destructive" pendingText="处理中…">
              确认{label}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Approve (with an optionally edited payload) or reject a create/update proposal. */
export function ReviewForm({ id, initialPayload }: { id: number; initialPayload: string }) {
  const [state, formAction] = useActionState(approveAction, {});
  const [text, setText] = useState(initialPayload);
  const edited = text !== initialPayload;
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h3 className="font-medium">审核与编辑</h3>
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <div className="grid gap-1.5">
          <Label htmlFor="payload">
            提案内容（JSON）
            {edited && <span className="ml-2 text-xs text-soon-foreground">已修改</span>}
          </Label>
          <Textarea
            id="payload"
            name="payload"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            aria-invalid={!!state.error}
            className="min-h-96 font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            通过时会按 productSchema / dealSchema 校验；未通过会在下方列出问题，已输入内容不会丢失。
          </p>
        </div>
        <FormErrors state={state} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid min-w-60 flex-1 gap-1.5">
            <Label htmlFor="note">备注（可选）</Label>
            <Input id="note" name="note" maxLength={2000} />
          </div>
          <SubmitButton size="lg" pendingText="发布中…">
            通过并发布
          </SubmitButton>
        </div>
      </form>
      <div className="flex justify-end border-t pt-3">
        <RejectDialog id={id} />
      </div>
    </section>
  );
}

/** Flag review: hide the affected deal, or dismiss the flag. */
export function FlagActions({ id, canHide }: { id: number; canHide: boolean }) {
  const [state, formAction] = useActionState(resolveFlagAction, {});
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h3 className="font-medium">处理异常</h3>
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value="hide" />
        <div className="grid gap-1.5">
          <Label htmlFor="flag-note">备注（可选）</Label>
          <Input id="flag-note" name="note" maxLength={2000} />
        </div>
        <FormErrors state={state} />
        <div className="flex flex-wrap gap-3">
          {canHide && (
            <SubmitButton variant="destructive" pendingText="隐藏中…">
              隐藏优惠
            </SubmitButton>
          )}
        </div>
      </form>
      <div className="border-t pt-3">
        <RejectDialog id={id} label="忽略" decision="dismiss" />
      </div>
    </section>
  );
}
