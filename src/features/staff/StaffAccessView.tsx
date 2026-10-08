import type { FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { messages } from '@/i18n/messages'

export function StaffAccessView({ pin, onPinChange, onSubmit, pending = false, error = null }: {
  pin: string; onPinChange: (pin: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; pending?: boolean; error?: string | null
}) {
  return <>
        <DialogHeader>
          <DialogTitle>{messages.staff.accessTitle}</DialogTitle>
          <DialogDescription>{messages.staff.accessDescription}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="staff-pin">{messages.staff.pinLabel}</Label>
            <Input
              id="staff-pin"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="numeric h-14 text-center text-2xl font-semibold tracking-[0.35em]"
              value={pin}
              onChange={(event) => onPinChange(event.target.value)}
              autoFocus
            />
          </div>
          {error !== null ? (
            <p className="rounded-chip bg-[#fdeceb] px-3.5 py-2.5 text-[0.75rem]/[1.6] text-[#a32118]" role="alert">
              {error}
            </p>
          ) : null}
          <Button className="w-full" disabled={pending || pin.trim().length === 0}>
            {pending ? messages.common.checking : messages.staff.continueAction}
          </Button>
        </form>
  </>
}
