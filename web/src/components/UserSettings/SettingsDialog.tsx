import type { ReactNode } from 'react'
import {
  ModalDialog,
  ModalDialogContent,
  ModalDialogHeader,
  ModalDialogHeading,
  ModalDialogClose,
  ModalDialogScrollArea,
  ModalDialogBody,
  useModalDialog,
} from '../../atoms/ModalDialog'

export const fieldClass =
  'w-full min-h-12 rounded-8 border border-solid-gray-600 bg-white px-3 py-2 focus-visible:outline focus-visible:outline-4 focus-visible:outline-black focus-visible:ring-4 focus-visible:ring-yellow-300 disabled:bg-solid-gray-50'

export function SettingsDialog({
  title,
  busy,
  onClose,
  children,
}: {
  title: string
  busy: boolean
  onClose: () => void
  children: ReactNode
}) {
  const { dialogProps, headingProps, closeButtonProps } = useModalDialog({
    open: true,
    onOpenChange: (open) => {
      if (!open && !busy) onClose()
    },
  })
  return (
    <ModalDialog {...dialogProps} scroll="inner" width="38rem">
      <ModalDialogContent>
        <ModalDialogHeader>
          <ModalDialogHeading {...headingProps}>{title}</ModalDialogHeading>
          <ModalDialogClose {...closeButtonProps} disabled={busy} />
        </ModalDialogHeader>
        <ModalDialogScrollArea>
          <ModalDialogBody>{children}</ModalDialogBody>
        </ModalDialogScrollArea>
      </ModalDialogContent>
    </ModalDialog>
  )
}
