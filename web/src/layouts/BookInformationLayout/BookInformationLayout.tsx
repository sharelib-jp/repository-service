import { useId, useState } from 'react'
import { FormControlLabel, Label, Legend } from '../../atoms/FormControlLabel'
import { Input } from '../../atoms/Input'
import { Select } from '../../atoms/Select'
import { Button } from '../../atoms/Button'
import {
  DatePicker,
  DatePickerDate,
  DatePickerMonth,
  DatePickerYear,
} from '../../atoms/DatePicker'
import { Divider } from '../../atoms/Divider'
import { Heading, HeadingTitle } from '../../atoms/Heading'
import { JsonEditor } from '../../components/JsonEditor'
import { ReferenceInformation } from '../../components/ReferenceInformation'
import { ShelvingList } from '../../components/ShelvingList/ShelvingList'
import { TwoColumnLayout } from '../../components/TwoColumnLayout'
import {
  AuthorityDialog,
  type Authority,
} from '../../components/AuthorityDialog'
import { authoritySummary } from '../../components/AuthorityDialog/authority'

const horizontalFormLayoutStyle = `
      [overflow-wrap:anywhere]
      md:grid md:[grid-template:'label_field_field'_auto_'support-text_field_field'_1fr_/_1fr_1fr_1fr] md:gap-x-6 md:justify-start md:items-baseline
      md:[&>label]:self-baseline md:[&>label]:[grid-area:label]
      md:[&>p]:[grid-area:support-text]
      md:[&>legend]:contents md:[&>legend>span]:[grid-area:label] md:[&>legend>span]:justify-self-start
    `

function LeftColumn() {
  const id = useId()
  const [referenceInformation, setReferenceInformation] = useState('')
  const [authors, setAuthors] = useState<Authority[]>([])
  const [publishers, setPublishers] = useState<Authority[]>([])
  const [authorDialogOpen, setAuthorDialogOpen] = useState(false)
  const [publisherDialogOpen, setPublisherDialogOpen] = useState(false)
  return (
    <div className="p-4 min-h-full gap-4 flex flex-col">
      <Heading hasChip={false} size="20">
        <HeadingTitle level="h3">基本情報</HeadingTitle>
      </Heading>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-select-1`}>資料種別</Label>
        <div className="min-w-0 [grid-area:field]">
          <Select
            id={`${id}-select-1`}
            blockSize="md"
            required
            isError
            aria-describedby={`${id}-select-1-error ${id}-select-1-support`}
            className="w-full"
          >
            <option value="">選択してください</option>
            {['図書', '電子図書', '冊子', '音声', '映像'].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </div>
      </FormControlLabel>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-input-2`}>タイトル</Label>
        <div className="min-w-0 [grid-area:field]">
          <Input
            id={`${id}-input-2`}
            blockSize="md"
            isError
            aria-describedby={`${id}-input-2-error ${id}-input-2-support`}
            className="w-full"
          />
        </div>
      </FormControlLabel>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-input-3`}>タイトルヨミ</Label>
        <div className="min-w-0 [grid-area:field]">
          <Input
            id={`${id}-input-3`}
            blockSize="md"
            isError
            aria-describedby={`${id}-input-3-error ${id}-input-3-support`}
            className="w-full"
          />
        </div>
      </FormControlLabel>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-input-4`}>著者名</Label>
        <div className="min-w-0 [grid-area:field]">
          <Input
            id={`${id}-input-4`}
            blockSize="md"
            isError
            aria-describedby={`${id}-input-4-error ${id}-input-4-support`}
            className="w-full"
            aria-disabled
            value={authoritySummary(authors, 'author')}
          />
        </div>
      </FormControlLabel>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-input-5`}>著者名ヨミ</Label>
        <div className="min-w-0 [grid-area:field]">
          <Input
            id={`${id}-input-5`}
            blockSize="md"
            isError
            aria-disabled
            aria-describedby={`${id}-input-5-error ${id}-input-5-support`}
            className="w-full"
            value={authoritySummary(authors, 'author', true)}
          />
        </div>
      </FormControlLabel>
      <Button
        type="button"
        size="md"
        className="w-full"
        variant="outline"
        onClick={() => setAuthorDialogOpen(true)}
      >
        著者典拠情報と紐付け
      </Button>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-input-6`}>出版社名</Label>
        <div className="min-w-0 [grid-area:field]">
          <Input
            id={`${id}-input-6`}
            blockSize="md"
            isError
            aria-describedby={`${id}-input-6-error ${id}-input-6-support`}
            className="w-full"
            aria-disabled
            value={authoritySummary(publishers, 'publisher')}
          />
        </div>
      </FormControlLabel>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-input-7`}>出版社名ヨミ</Label>
        <div className="min-w-0 [grid-area:field]">
          <Input
            id={`${id}-input-7`}
            blockSize="md"
            isError
            aria-disabled
            aria-describedby={`${id}-input-7-error ${id}-input-7-support`}
            className="w-full"
            value={authoritySummary(publishers, 'publisher', true)}
          />
        </div>
      </FormControlLabel>
      <Button
        type="button"
        size="md"
        className="w-full"
        variant="outline"
        onClick={() => setPublisherDialogOpen(true)}
      >
        出版社典拠情報と紐付け
      </Button>
      <FormControlLabel
        as="fieldset"
        className={horizontalFormLayoutStyle}
        aria-describedby={`${id}-date-support`}
      >
        <Legend>
          <span>出版年（初版）</span>
        </Legend>
        <div className="min-w-0 [grid-area:field]">
          <DatePicker size="md" isError>
            {({ yearRef, monthRef, dateRef, ...rest }) => (
              <>
                <DatePickerYear
                  ref={yearRef}
                  required
                  aria-describedby={`${id}-date-error`}
                  {...rest}
                />
                <DatePickerMonth
                  ref={monthRef}
                  required
                  aria-describedby={`${id}-date-error`}
                  {...rest}
                />
                <DatePickerDate
                  ref={dateRef}
                  required
                  aria-describedby={`${id}-date-error`}
                  {...rest}
                />
              </>
            )}
          </DatePicker>
        </div>
      </FormControlLabel>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-input-8`}>NDC</Label>
        <div className="min-w-0 [grid-area:field]">
          <Input
            id={`${id}-input-8`}
            blockSize="md"
            isError
            aria-describedby={`${id}-input-8-error ${id}-input-8-support`}
            className="w-full"
          />
        </div>
      </FormControlLabel>
      <Divider />
      <ReferenceInformation
        value={referenceInformation}
        onChange={setReferenceInformation}
      />
      <AuthorityDialog
        kind="author"
        open={authorDialogOpen}
        value={authors}
        onOpenChange={setAuthorDialogOpen}
        onApply={setAuthors}
      />
      <AuthorityDialog
        kind="publisher"
        open={publisherDialogOpen}
        value={publishers}
        onOpenChange={setPublisherDialogOpen}
        onApply={setPublishers}
      />
    </div>
  )
}

function RightColumn({ bookId }: { bookId?: string }) {
  const id = useId()
  const [additionalAttributes, setAdditionalAttributes] = useState('')
  const [attributesTouched, setAttributesTouched] = useState(false)
  let invalidAttributes = false

  if (attributesTouched && additionalAttributes.trim() !== '') {
    try {
      JSON.parse(additionalAttributes)
    } catch {
      invalidAttributes = true
    }
  }

  return (
    <div className="p-4 min-h-full gap-4 flex flex-col">
      <Heading hasChip={false} size="20">
        <HeadingTitle level="h3">登録情報</HeadingTitle>
      </Heading>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-input-1`}>書誌情報 ID (ULID)</Label>
        <div className="min-w-0 [grid-area:field]">
          <Input
            id={`${id}-input-1`}
            blockSize="md"
            isError
            aria-disabled
            aria-describedby={`${id}-input-1-error ${id}-input-1-support`}
            className="w-full"
            value={bookId ?? '書誌情報 ID は登録時に設定されます'}
          />
        </div>
      </FormControlLabel>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-input-2`}>書籍情報登録日時</Label>
        <div className="min-w-0 [grid-area:field]">
          <Input
            id={`${id}-input-2`}
            blockSize="md"
            isError
            aria-disabled
            aria-describedby={`${id}-input-2-error ${id}-input-2-support`}
            className="w-full"
            value={bookId === undefined ? '登録日時は保存時に設定されます' : ''}
          />
        </div>
      </FormControlLabel>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-input-3`}>書籍情報最終更新日時</Label>
        <div className="min-w-0 [grid-area:field]">
          <Input
            id={`${id}-input-3`}
            blockSize="md"
            isError
            aria-disabled
            aria-describedby={`${id}-input-3-error ${id}-input-3-support`}
            className="w-full"
            value={bookId === undefined ? '登録日時は保存時に設定されます' : ''}
          />
        </div>
      </FormControlLabel>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-input-4`}>登録者</Label>
        <div className="min-w-0 [grid-area:field]">
          <Input
            id={`${id}-input-4`}
            blockSize="md"
            isError
            aria-disabled
            aria-describedby={`${id}-input-4-error ${id}-input-4-support`}
            className="w-full"
            value={bookId === undefined ? '登録日時は保存時に設定されます' : ''}
          />
        </div>
      </FormControlLabel>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-input-5`}>最終更新者</Label>
        <div className="min-w-0 [grid-area:field]">
          <Input
            id={`${id}-input-5`}
            blockSize="md"
            isError
            aria-disabled
            aria-describedby={`${id}-input-5-error ${id}-input-5-support`}
            className="w-full"
            value={bookId === undefined ? '登録日時は保存時に設定されます' : ''}
          />
        </div>
      </FormControlLabel>
      <ShelvingList />
      <Heading hasChip={false} size="20">
        <HeadingTitle level="h3">その他の属性情報</HeadingTitle>
      </Heading>
      <JsonEditor
        label="その他の属性情報（JSON）"
        name="additionalAttributes"
        value={additionalAttributes}
        onChange={setAdditionalAttributes}
        onBlur={() => setAttributesTouched(true)}
      />
      {invalidAttributes && (
        <p role="alert" className="text-std-16N-170 text-error-1">
          JSON の形式を確認してください。
        </p>
      )}
    </div>
  )
}

export type BookInformationLayoutProps = {
  bookId?: string
}

export function BookInformationLayout({ bookId }: BookInformationLayoutProps) {
  return (
    <TwoColumnLayout
      left={<LeftColumn />}
      right={<RightColumn bookId={bookId} />}
      initialLeftWidth={500}
      minLeftWidth={360}
      minRightWidth={360}
    />
  )
}
