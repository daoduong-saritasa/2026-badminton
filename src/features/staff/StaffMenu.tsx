import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { KeyRound, LogOut } from 'lucide-react'

import { rotateStaffPin, signOutStaff } from '@/data/staff'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorMessage } from '@/i18n/errors'
import { messages } from '@/i18n/vi'
import type { StaffRole } from '@/domain/types'

export function StaffMenu({
  role,
  onSignedOut,
}: {
  role: StaffRole
  onSignedOut: () => void
}) {
  const [rotationOpen, setRotationOpen] = useState(false)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [rotationRole, setRotationRole] = useState<StaffRole>('organizer')
  const [nextPin, setNextPin] = useState('')
  const signOutMutation = useMutation({
    mutationFn: signOutStaff,
    onSuccess: onSignedOut,
  })
  const rotationMutation = useMutation({
    mutationFn: ({ role: nextRole, pin }: { role: StaffRole; pin: string }) =>
      rotateStaffPin(nextRole, pin),
    onSuccess: () => {
      setNextPin('')
      setConfirmationOpen(false)
      setRotationOpen(false)
    },
  })

  const handleRotationSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setConfirmationOpen(true)
  }

  const openRotation = (nextRole: StaffRole) => {
    setRotationRole(nextRole)
    setRotationOpen(true)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="border-rule bg-transparent text-muted-ink hover:bg-white">
            <KeyRound /> {messages.staff.role[role]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{messages.staff.role[role]}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {role === 'organizer' ? (
            <>
              <DropdownMenuItem onSelect={() => openRotation('organizer')}>
                <KeyRound /> {messages.staff.rotateOrganizerPin}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openRotation('referee')}>
                <KeyRound /> {messages.staff.rotateRefereePin}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem
            variant="destructive"
            disabled={signOutMutation.isPending}
            onSelect={() => signOutMutation.mutate()}
          >
            <LogOut /> {messages.staff.signOut}
          </DropdownMenuItem>
          {signOutMutation.isError ? (
            <p className="mx-1 mt-1 rounded-chip bg-[#fdeceb] px-3 py-2 text-[0.6875rem]/[1.5] text-[#a32118]" role="alert">
              {errorMessage(signOutMutation.error)}
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={rotationOpen} onOpenChange={setRotationOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{messages.staff.rotateTitle[rotationRole]}</DialogTitle>
            <DialogDescription>{messages.staff.rotateDescription[rotationRole]}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleRotationSubmit}>
            <div className="space-y-2">
              <Label htmlFor="new-staff-pin">{messages.staff.newPinLabel}</Label>
              <Input
                id="new-staff-pin"
                inputMode="numeric"
                autoComplete="new-password"
                className="numeric h-14 text-center text-2xl font-semibold tracking-[0.35em]"
                value={nextPin}
                onChange={(event) => setNextPin(event.target.value)}
              />
            </div>
            {rotationMutation.isError ? (
              <p className="text-[0.75rem]/[1.6] text-[#a32118]" role="alert">{errorMessage(rotationMutation.error)}</p>
            ) : null}
            <Button className="w-full" disabled={nextPin.trim().length === 0}>{messages.staff.reviewRotation}</Button>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmationOpen} onOpenChange={setConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.staff.confirmRotateTitle[rotationRole]}</AlertDialogTitle>
            <AlertDialogDescription>
              {messages.staff.confirmRotateBody[rotationRole]}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.staff.keepPin}</AlertDialogCancel>
            <AlertDialogAction
              disabled={rotationMutation.isPending}
              onClick={() => rotationMutation.mutate({ role: rotationRole, pin: nextPin })}
            >
              {rotationMutation.isPending ? messages.staff.rotating : messages.staff.confirmRotate}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
