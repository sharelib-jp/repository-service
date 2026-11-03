import { useId } from 'react'
import EditorImport from 'react-simple-code-editor'

// The package's CommonJS export may be wrapped by the bundler.
const Editor = (EditorImport as unknown as { default?: typeof EditorImport }).default ?? EditorImport

export type JsonEditorProps = {
  label: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  name?: string
}

export function JsonEditor({ label, value, onChange, onBlur, name }: JsonEditorProps) {
  const id = useId()

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="text-std-17B-170 text-solid-gray-800">
        {label}
      </label>
      <Editor
        textareaId={id}
        name={name}
        value={value}
        onValueChange={onChange}
        onBlur={onBlur}
        highlight={(code) => <>{code}</>}
        ignoreTabKey
        padding={12}
        className="min-h-40 overflow-auto rounded-8 border border-solid-gray-600 bg-white text-solid-gray-900 focus-within:outline focus-within:outline-4 focus-within:outline-black focus-within:outline-offset-2 focus-within:ring-2 focus-within:ring-yellow-300"
        textareaClassName="focus:outline-none"
        style={{ fontFamily: 'monospace', fontSize: 16, lineHeight: 1.5 }}
      />
    </div>
  )
}
