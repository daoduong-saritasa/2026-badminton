import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { signInStaff, StaffAccessError } from '@/data/staff'
import type { StaffAccess } from '@/domain/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function accessErrorMessage(error: Error): string {
  if (error instanceof StaffAccessError && error.code === 'rate_limited' && error.retryAfterSeconds) {
    const minutes = Math.max(1, Math.ceil(error.retryAfterSeconds / 60))
    return `Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`
  }
  return error.message
}

export function StaffAccessDialog({
  open,
  onOpenChange,
  onGranted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onGranted: (access: StaffAccess) => void
}) {
  const [pin, setPin] = useState('')
  const signInMutation = useMutation({
    mutationFn: signInStaff,
    onSuccess: (access) => {
      setPin('')
      onGranted(access)
      onOpenChange(false)
    },
  })

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    signInMutation.mutate(pin)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !signInMutation.isPending) {
      setPin('')
      signInMutation.reset()
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="rounded-2xl bg-white sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Staff access</DialogTitle>
          <DialogDescription>Enter the tournament staff PIN.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="staff-pin">Staff PIN</Label>
            <Input
              id="staff-pin"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              autoFocus
            />
          </div>
          {signInMutation.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {accessErrorMessage(signInMutation.error)}
            </p>
          ) : null}
          <Button className="w-full rounded-full" disabled={signInMutation.isPending}>
            {signInMutation.isPending ? 'Checking…' : 'Continue'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
