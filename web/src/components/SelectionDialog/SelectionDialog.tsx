import {
  ModalDialog,
  ModalDialogBody,
  ModalDialogClose,
  ModalDialogContent,
  ModalDialogHeader,
  ModalDialogHeading,
  ModalDialogScrollArea,
  useModalDialog,
} from '../../atoms/ModalDialog'
import { Button } from '../../atoms/Button'

export type SelectionOption = { readonly value: string; readonly label: string }

export type SelectionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  options: readonly SelectionOption[]
  onSelect: (value: string) => void
  error?: string
}

export function SelectionDialog({
  open,
  onOpenChange,
  title,
  options,
  onSelect,
  error,
}: SelectionDialogProps) {
  const { dialogProps, headingProps, closeButtonProps } = useModalDialog({
    open,
    onOpenChange,
  })

  return (
    <ModalDialog {...dialogProps} scroll="inner" width="32rem">
      <ModalDialogContent>
        <ModalDialogHeader>
          <ModalDialogHeading {...headingProps}>{title}</ModalDialogHeading>
          <ModalDialogClose {...closeButtonProps} />
        </ModalDialogHeader>
        <ModalDialogScrollArea>
          <ModalDialogBody>
            {error && (
              <p role="alert" className="mb-4 text-error-1">
                {error}
              </p>
            )}
            <ul className="flex flex-col gap-2 my-4">
              {options.map((option) => (
                <li key={option.value}>
                  <Button
                    type="button"
                    size="md"
                    variant="outline"
                    className="w-full"
                    onClick={() => onSelect(option.value)}
                  >
                    {option.label}
                  </Button>
                </li>
              ))}
            </ul>
          </ModalDialogBody>
        </ModalDialogScrollArea>
      </ModalDialogContent>
    </ModalDialog>
  )
}
