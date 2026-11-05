import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  SearchBox,
  SearchBoxFields,
  SearchBoxInput,
  SearchBoxSelect,
  SearchBoxSubmit,
} from '../../atoms/SearchBox'
import { Button } from '../../atoms/Button'
import { BookInformationLayout } from '../../layouts/BookInformationLayout'
import { useBookEditor } from '../../layouts/BookInformationLayout/useBookEditor'

export const Route = createFileRoute('/books/register')({
  component: RouteComponent,
})

function RouteComponent() {
  const navigate = useNavigate()
  const editor = useBookEditor()
  async function save(next: boolean) {
    const saved = await editor.save()
    if (!saved?.id) return
    if (next) editor.reset()
    else await navigate({ to: '/books/edit/$bookId', params: { bookId: saved.id } })
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SearchBox size="lg" className="m-4 shrink-0">
        <SearchBoxFields>
          <SearchBoxSelect label="検索先" name="scope" className="w-24">
            <option value="">国立国会図書館</option>
          </SearchBoxSelect>
          <SearchBoxSelect label="検索キー" name="scope">
            <option value="ISBN">ISBN</option>
          </SearchBoxSelect>
          <SearchBoxInput label="検索" name="q" type="search" />
        </SearchBoxFields>
        <SearchBoxSubmit size="lg" type="submit" variant="outline">
          検索
        </SearchBoxSubmit>
      </SearchBox>
      <div className="min-h-0 flex-1">
        <BookInformationLayout
          key={editor.revision}
          value={editor.draft}
          onChange={editor.change}
          onBeginAuthorityEdit={editor.cancelLookup}
          busy={editor.saving}
        />
      </div>
      {editor.error && <p role="alert" className="px-4 text-error-1">{editor.error}</p>}
      {editor.message && <p role="status" className="px-4">{editor.message}</p>}
      <div
        role="group"
        aria-label="書籍の操作"
        className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-solid-gray-300 bg-white px-4 py-3"
      >
        <Button type="button" size="md" variant="outline" disabled={editor.saving}
          onClick={() => {
            if (!editor.dirty || window.confirm('入力内容をクリアしますか？')) editor.reset()
          }}>
          入力をクリア
        </Button>
        <Button type="button" size="md" variant="outline"
          disabled={editor.saving || editor.resolving} onClick={() => void save(false)}>
          保存
        </Button>
        <Button type="button" size="md" variant="solid-fill"
          disabled={editor.saving || editor.resolving} onClick={() => void save(true)}>
          保存して作成
        </Button>
      </div>
    </div>
  )
}
