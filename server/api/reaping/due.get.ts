import { getReapingList } from '../../utils/reaping'

// The Appointed Hour: titles whose grace has elapsed and are ready for the operator to action
// removal via the Sonarr/Radarr click-through. Soonest-due first.
export default defineEventHandler(() => {
  const rows = getReapingList(['due'])
  rows.sort((a, b) => Date.parse(a.dueAt ?? '') - Date.parse(b.dueAt ?? ''))
  return { rows }
})
