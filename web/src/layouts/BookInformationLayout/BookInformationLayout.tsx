import { useId, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { BookDraft } from './bookDraft'
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

type DraftProps = {
  value: BookDraft
  onChange: Dispatch<SetStateAction<BookDraft>>
  onBeginAuthorityEdit?: () => void
}

function LeftColumn({ value, onChange, onBeginAuthorityEdit }: DraftProps) {
  const id = useId()
  const {
    reference: referenceInformation,
    title,
    transcription,
    ndc,
    volume,
    date,
    authors,
    publishers,
  } = value
  const [authorDialogOpen, setAuthorDialogOpen] = useState(false)
  const [publisherDialogOpen, setPublisherDialogOpen] = useState(false)
  function update<K extends keyof BookDraft>(key: K, next: BookDraft[K]) {
    onChange((current) => ({ ...current, [key]: next }))
  }
  const setTitle = (next: string) => update('title', next)
  const setTranscription = (next: string) => update('transcription', next)
  const setNdc = (next: string) => update('ndc', next)
  const setVolume = (next: string) => update('volume', next)
  const setDate = (next: (current: BookDraft['date']) => BookDraft['date']) =>
    onChange((current) => ({ ...current, date: next(current.date) }))
  const setAuthors = (next: Authority[]) => update('authors', next)
  const setPublishers = (next: Authority[]) => update('publishers', next)
  const setReferenceInformation = (next: string) => update('reference', next)
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
            value={value.materialType}
            onChange={(event) => update('materialType', event.target.value)}
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
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            blockSize="md"

            className="w-full"
          />
        </div>
      </FormControlLabel>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-input-3`}>タイトルヨミ</Label>
        <div className="min-w-0 [grid-area:field]">
          <Input
            id={`${id}-input-3`}
            value={transcription}
            onChange={(event) => setTranscription(event.target.value)}
            blockSize="md"

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

            aria-disabled

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
        onClick={() => {
          onBeginAuthorityEdit?.()
          setAuthorDialogOpen(true)
        }}
      >
        著者典拠情報と紐付け
      </Button>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-input-6`}>出版社名</Label>
        <div className="min-w-0 [grid-area:field]">
          <Input
            id={`${id}-input-6`}
            blockSize="md"

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

            aria-disabled

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
        onClick={() => {
          onBeginAuthorityEdit?.()
          setPublisherDialogOpen(true)
        }}
      >
        出版社典拠情報と紐付け
      </Button>
      <FormControlLabel as="fieldset" className={horizontalFormLayoutStyle}>
        <Legend>
          <span>出版年（初版）</span>
        </Legend>
        <div className="min-w-0 [grid-area:field]">
          <DatePicker size="md">
            {({ yearRef, monthRef, dateRef, ...rest }) => (
              <>
                <DatePickerYear
                  ref={yearRef}
                  value={date.year}
                  onChange={(event) =>
                    setDate((current) => ({
                      ...current,
                      year: event.target.value,
                    }))
                  }

                  {...rest}
                />
                <DatePickerMonth
                  ref={monthRef}
                  value={date.month}
                  onChange={(event) =>
                    setDate((current) => ({
                      ...current,
                      month: event.target.value,
                    }))
                  }

                  {...rest}
                />
                <DatePickerDate
                  ref={dateRef}
                  value={date.day}
                  onChange={(event) =>
                    setDate((current) => ({
                      ...current,
                      day: event.target.value,
                    }))
                  }

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
            value={ndc}
            onChange={(event) => setNdc(event.target.value)}
            blockSize="md"

            className="w-full"
          />
        </div>
      </FormControlLabel>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-volume`}>巻次</Label>
        <div className="min-w-0 [grid-area:field]">
          <Input
            id={`${id}-volume`}
            blockSize="md"
            value={volume}
            onChange={(event) => setVolume(event.target.value)}
            className="w-full"
          />
        </div>
      </FormControlLabel>
      <Divider />
      <ReferenceInformation
        value={referenceInformation}
        onChange={setReferenceInformation}
        onValidityChange={(valid) => {
          if (value.referenceValid !== valid) update('referenceValid', valid)
        }}
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

function RightColumn({ value, onChange }: DraftProps) {
  const id = useId()
  const additionalAttributes = value.otherAttributes
  const [attributesTouched, setAttributesTouched] = useState(false)
  const saved = value.saved
  const setAdditionalAttributes = (next: string) =>
    onChange((current) => ({ ...current, otherAttributes: next }))
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

            aria-disabled

            className="w-full"
            value={saved?.id ?? '書誌情報 ID は登録時に設定されます'}
          />
        </div>
      </FormControlLabel>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-input-2`}>書籍情報登録日時</Label>
        <div className="min-w-0 [grid-area:field]">
          <Input
            id={`${id}-input-2`}
            blockSize="md"

            aria-disabled

            className="w-full"
            value={saved?.createdAt ?? '登録日時は保存時に設定されます'}
          />
        </div>
      </FormControlLabel>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-input-3`}>書籍情報最終更新日時</Label>
        <div className="min-w-0 [grid-area:field]">
          <Input
            id={`${id}-input-3`}
            blockSize="md"

            aria-disabled

            className="w-full"
            value={saved?.updatedAt ?? '更新日時は保存時に設定されます'}
          />
        </div>
      </FormControlLabel>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-input-4`}>登録者</Label>
        <div className="min-w-0 [grid-area:field]">
          <Input
            id={`${id}-input-4`}
            blockSize="md"

            aria-disabled

            className="w-full"
            value={saved?.createdBy ?? '登録者は保存時に設定されます'}
          />
        </div>
      </FormControlLabel>
      <FormControlLabel className={horizontalFormLayoutStyle}>
        <Label htmlFor={`${id}-input-5`}>最終更新者</Label>
        <div className="min-w-0 [grid-area:field]">
          <Input
            id={`${id}-input-5`}
            blockSize="md"

            aria-disabled

            className="w-full"
            value={saved?.updatedBy ?? '更新者は保存時に設定されます'}
          />
        </div>
      </FormControlLabel>
      <ShelvingList
        value={value.copies}
        onChange={(copies) => onChange((current) => ({ ...current, copies }))}
      />
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

export type BookInformationLayoutProps = DraftProps & { busy?: boolean }

export function BookInformationLayout({
  value,
  onChange,
  onBeginAuthorityEdit,
  busy = false,
}: BookInformationLayoutProps) {
  return (
    <fieldset disabled={busy} className="h-full min-h-0 min-w-0 border-0 p-0">
      <legend className="sr-only">書誌情報</legend>
      <TwoColumnLayout
        left={
          <LeftColumn
            value={value}
            onChange={onChange}
            onBeginAuthorityEdit={onBeginAuthorityEdit}
          />
        }
        right={<RightColumn value={value} onChange={onChange} />}
        initialLeftWidth={500}
        minLeftWidth={360}
        minRightWidth={360}
      />
    </fieldset>
  )
}
