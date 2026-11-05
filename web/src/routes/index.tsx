import { createFileRoute, Link } from '@tanstack/react-router'
import { Heading, HeadingTitle } from '../atoms/Heading'

export const Route = createFileRoute('/')({
  component: HomePage,
})

const menuItems = [
  {
    title: '登録済み蔵書一覧',
    description: '登録済みの蔵書を検索・確認します。',
    to: '/books',
  },
  {
    title: '単件蔵書情報登録',
    description: '１件ずつ蔵書を登録します。',
    to: '/books/register',
  },
  {
    title: '単件蔵書情報更新',
    description: '１件ずつ蔵書情報を更新します。',
    to: '/books/edit',
  },
  {
    title: '単件蔵書変更履歴',
    description: '蔵書情報の変更履歴を確認します。',
    to: '/books/history',
  },
  {
    title: '登録著者典拠一覧',
    description: '登録済みの著者典拠情報を確認します。',
    to: '/authors',
  },
  {
    title: '登録出版社典拠一覧',
    description: '登録済みの出版社典拠情報を検索・編集します。',
    to: '/publishers',
  },
  {
    title: 'ユーザー・ロール設定',
    description: 'ユーザーの状態・所属ロールとロールの設定を管理します。',
    to: '/settings/users',
  },
] as const

function HomePage() {
  return (
    <div className="p-4 md:p-6">
      <Heading hasChip size="24" className="mb-6">
        <HeadingTitle level="h1">業務メニュー</HeadingTitle>
      </Heading>
      <ul className="flex flex-wrap gap-4">
        {menuItems.map((item) => {
          const content = (
            <>
              <Heading size="20">
                <HeadingTitle level="h2">{item.title}</HeadingTitle>
              </Heading>
              <p className="mt-2 text-solid-gray-700">{item.description}</p>
              {!('to' in item) && (
                <p className="mt-4 text-sm text-solid-gray-700">準備中</p>
              )}
            </>
          )
          const cardClass =
            'block h-full min-h-36 rounded-8 border border-solid-gray-300 bg-white p-5'

          return (
            <li key={item.title} className="w-80 max-w-full shrink-0">
              {'to' in item ? (
                <Link
                  to={item.to}
                  className={`${cardClass} hover:border-key-900 hover:bg-key-50 focus-visible:outline focus-visible:outline-4 focus-visible:outline-black focus-visible:outline-offset-2 focus-visible:ring-4 focus-visible:ring-yellow-300`}
                >
                  {content}
                </Link>
              ) : (
                <div className={cardClass}>{content}</div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
