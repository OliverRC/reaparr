import { getReapingList } from '../../utils/reaping'

// The Sands: titles with a running clock (scheduled) plus any with an open appeal (appealed),
// with the appealed ones floated to the top, then soonest-due first.
export default defineEventHandler(() => {
  const rows = getReapingList(['scheduled', 'appealed'])
  rows.sort((a, b) => {
    if (a.state !== b.state) return a.state === 'appealed' ? -1 : 1 // appeals first
    return Date.parse(a.dueAt ?? '') - Date.parse(b.dueAt ?? '') // soonest due first
  })
  return { rows }
})
