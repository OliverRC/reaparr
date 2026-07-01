import { getDashboard, type DashboardSort, type DashboardType } from '../utils/dashboard'

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const type: DashboardType = q.type === 'movie' ? 'movie' : 'series'
  const sort: DashboardSort = q.sort === 'size' ? 'size' : 'score'
  const rows = getDashboard(type, sort)
  const totalSize = rows.reduce((acc, r) => acc + r.sizeOnDisk, 0)
  // Spared titles are keepers — never part of the reclaim story.
  const reclaimable = rows.filter(r => !r.spared && r.reapScore >= 50).reduce((acc, r) => acc + r.sizeOnDisk, 0)
  const sparedRows = rows.filter(r => r.spared)
  const sparedCount = sparedRows.length
  const sparedSize = sparedRows.reduce((acc, r) => acc + r.sizeOnDisk, 0)
  return { type, sort, count: rows.length, totalSize, reclaimable, sparedCount, sparedSize, rows }
})
