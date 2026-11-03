// Compatibility adapter; the API's mapping configuration owns provider fields.
import { searchExternalAuthorities } from '../../api/authorities.ts'
import type { AuthoritySearch } from './authority'
export const searchWikidata: AuthoritySearch = (query, kind, signal) =>
  searchExternalAuthorities(
    {
      name: 'wikidata',
      label: 'Wikidata',
      resource: 'authorities',
      queryFields: ['keyword'],
    },
    query,
    kind,
    signal,
  )
