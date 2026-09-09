import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { KeyRound, LogOut, Settings2, TabletSmartphone } from 'lucide-react'

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

export function StaffMenu({
  onNavigate,
  onSignedOut,
}: {
  onNavigate: (view: 'scoring' | 'organizer') => void
  onSignedOut: () => void
}) {
  const [rotationOpen, setRotationOpen] = useState(false)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [nextPin, setNextPin] = useState('')
  const signOutMutation = useMutation({
    mutationFn: signOutStaff,
    onSuccess: onSignedOut,
  })
  const rotationMutation = useMutation({
    mutationFn: rotateStaffPin,
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

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="rounded-full text-xs text-muted-foreground">
            <KeyRound /> Staff menu
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>Tournament staff</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onNavigate('scoring')}>
            <TabletSmartphone /> Referee scoring
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onNavigate('organizer')}>
            <Settings2 /> Organizer
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRotationOpen(true)}>
            <KeyRound /> Rotate PIN
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={signOutMutation.isPending}
            onSelect={() => signOutMutation.mutate()}
          >
            <LogOut /> Sign out
          </DropdownMenuItem>
          {signOutMutation.isError ? (
            <p className="px-2 py-1.5 text-xs text-destructive" role="alert">
              {signOutMutation.error.message}
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={rotationOpen} onOpenChange={setRotationOpen}>
        <DialogContent className="rounded-2xl bg-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rotate staff PIN</DialogTitle>
            <DialogDescription>All other staff grants will be revoked immediately.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleRotationSubmit}>
            <div className="space-y-2">
              <Label htmlFor="new-staff-pin">New PIN</Label>
              <Input
                id="new-staff-pin"
                inputMode="numeric"
                autoComplete="new-password"
                value={nextPin}
                onChange={(event) => setNextPin(event.target.value)}
              />
            </div>
            {rotationMutation.isError ? (
              <p className="text-sm text-destructive" role="alert">{rotationMutation.error.message}</p>
            ) : null}
            <Button className="w-full rounded-full">Review rotation</Button>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmationOpen} onOpenChange={setConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate the staff PIN?</AlertDialogTitle>
            <AlertDialogDescription>
              Other staff browsers will lose access and must enter the new PIN.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current PIN</AlertDialogCancel>
            <AlertDialogAction
              disabled={rotationMutation.isPending}
              onClick={() => rotationMutation.mutate(nextPin)}
            >
              {rotationMutation.isPending ? 'Rotating…' : 'Rotate PIN'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
