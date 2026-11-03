import { createFileRoute } from '@tanstack/react-router'
import {
  SearchBox,
  SearchBoxFields,
  SearchBoxInput,
  SearchBoxSelect,
  SearchBoxSubmit,
} from '../../atoms/SearchBox'
import { Button } from '../../atoms/Button'
import { BookInformationLayout } from '../../layouts/BookInformationLayout'

export const Route = createFileRoute('/books/register')({
  component: RouteComponent,
})

function RouteComponent() {
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
        <BookInformationLayout />
      </div>
      <div
        role="group"
        aria-label="書籍の操作"
        className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-solid-gray-300 bg-white px-4 py-3"
      >
        <Button type="button" size="md" variant="outline">
          削除
        </Button>
        <Button type="button" size="md" variant="outline">
          保存
        </Button>
        <Button type="button" size="md" variant="solid-fill">
          保存して作成
        </Button>
      </div>
    </div>
  )
}
