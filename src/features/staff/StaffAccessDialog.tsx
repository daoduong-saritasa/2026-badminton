import { StaffAccessView } from './StaffAccessView'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { signInStaff, StaffAccessError } from '@/data/staff'
import type { StaffAccess } from '@/domain/types'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { errorMessage } from '@/i18n/errors'
import { messages } from '@/i18n/messages'

function accessErrorMessage(error: Error): string {
  if (error instanceof StaffAccessError && error.code === 'rate_limited' && error.retryAfterSeconds) {
    const minutes = Math.max(1, Math.ceil(error.retryAfterSeconds / 60))
    return messages.staff.rateLimited(minutes)
  }
  return errorMessage(error)
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
      <DialogContent className="sm:max-w-sm">
        <StaffAccessView pin={pin} onPinChange={setPin} onSubmit={handleSubmit} pending={signInMutation.isPending} error={signInMutation.isError ? accessErrorMessage(signInMutation.error) : null} />
      </DialogContent>
    </Dialog>
  )
}
