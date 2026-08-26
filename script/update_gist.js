const { Octokit } = require('@octokit/rest')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')

dayjs.extend(utc)
dayjs.extend(timezone)

const GIST_TOKEN = process.env.GIST_TOKEN
const GIST_ID = process.env.GIST_ID
const GH_USERNAME = process.env.GH_USERNAME
const TIME_ZONE = 'Asia/Shanghai'

const DAYS_LOOKBACK = 365
const WINDOW_DAYS = Math.ceil(DAYS_LOOKBACK / 4) // 4 windows, each well under the 1000-result Search API cap
const MAX_PAGES = 10
const PER_PAGE = 100
const BAR_WIDTH = 20
const REQUEST_DELAY_MS = 2000 // spread requests to avoid burst-triggered secondary rate limits
const MAX_RETRIES = 2

if (!GIST_TOKEN || !GIST_ID) {
  console.error('❌ Missing required env: GIST_TOKEN or GIST_ID')
  process.exit(1)
}

const octokit = new Octokit({
  auth: GIST_TOKEN,
  userAgent: 'Gist-Updater-Node.js',
})

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function searchCommits(q, page) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await octokit.request('GET /search/commits', {
        q,
        sort: 'author-date',
        order: 'desc',
        per_page: PER_PAGE,
        page,
      })
    } catch (err) {
      const rateLimited = err.status === 403 && /rate limit/i.test(err.message)
      if (!rateLimited || attempt >= MAX_RETRIES) throw err
      const wait = 30_000 * (attempt + 1)
      console.warn(`⚠️ Rate limited, retrying in ${wait / 1000}s...`)
      await sleep(wait)
    }
  }
}

async function getCommitTimes() {
  const { data: user } = await octokit.users.getAuthenticated()
  console.log(`✅ Authenticated as: ${user.login}`)

  const username = GH_USERNAME || user.login

  const stats = {
    morning: 0,
    daytime: 0,
    evening: 0,
    night: 0,
  }

  const now = dayjs()
  const since = now.subtract(DAYS_LOOKBACK, 'day')

  for (let w = 0; w < 4; w++) {
    const start = since.add(w * WINDOW_DAYS, 'day')
    let end = start.add(WINDOW_DAYS, 'day').subtract(1, 'day') // exclusive end: no overlap with next window
    if (end.isAfter(now)) end = now

    const q = `author:${username} author-date:${start.format('YYYY-MM-DD')}..${end.format('YYYY-MM-DD')}`

    for (let page = 1; page <= MAX_PAGES; page++) {
      if (!(w === 0 && page === 1)) await sleep(REQUEST_DELAY_MS)

      const { data } = await searchCommits(q, page)

      if (page === 1) {
        console.log(`🔍 [window ${w + 1}/4] ${q}: ${data.total_count} commits`)
        if (data.total_count > MAX_PAGES * PER_PAGE) {
          console.warn(`⚠️ ${data.total_count} commits in this window, but Search API caps at ${MAX_PAGES * PER_PAGE}`)
        }
      }

      const items = data.items || []
      if (items.length === 0) break

      for (const item of items) {
        const hour = dayjs(item.commit.author.date).tz(TIME_ZONE).hour()

        if (hour >= 6 && hour < 12) {
          stats.morning++
        } else if (hour >= 12 && hour < 18) {
          stats.daytime++
        } else if (hour >= 18 && hour < 24) {
          stats.evening++
        } else {
          stats.night++
        }
      }

      if (items.length < PER_PAGE) break
    }
  }

  const total = stats.morning + stats.daytime + stats.evening + stats.night
  console.log(
    `📊 Counted ${total} commits (Morning: ${stats.morning}, Daytime: ${stats.daytime}, Evening: ${stats.evening}, Night: ${stats.night})`,
  )

  return { ...stats, total }
}

function generateMarkdown(stats) {
  const getPercent = num => (stats.total === 0 ? 0 : (num / stats.total) * 100).toFixed(1)
  const getBar = percent => {
    const filled = Math.round((percent / 100) * BAR_WIDTH)
    return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
  }

  const updateTime = dayjs().tz(TIME_ZONE).format('YYYY-MM-DD HH:mm:ss')

  const lines = [
    { emoji: '🌞', label: 'Morning', count: stats.morning },
    { emoji: '🏙️', label: 'Daytime', count: stats.daytime },
    { emoji: '🌆', label: 'Evening', count: stats.evening },
    { emoji: '🌙', label: 'Night', count: stats.night },
  ]

  const countWidth = Math.max(3, ...lines.map(l => String(l.count).length))

  const content = lines
    .map(({ emoji, label, count }) => {
      const percent = getPercent(count)
      const col1 = `${emoji} ${label.padEnd(7)}`
      const col2 = `${String(count).padStart(countWidth)} commits`
      const col3 = getBar(percent)
      return `${col1}   ${col2}   ${col3}`
    })
    .join('\n')

  return `${content}
> Last Updated: ${updateTime}
`
}

async function updateGist(content) {
  await octokit.gists.update({
    gist_id: GIST_ID,
    files: {
      'commit-habit.md': {
        content,
      },
    },
  })
  console.log('✅ Gist updated successfully!')
}

async function main() {
  try {
    const stats = await getCommitTimes()
    const markdown = generateMarkdown(stats)
    await updateGist(markdown)
  } catch (error) {
    console.error('Program execution failed: ', error.message)
    process.exit(1)
  }
}

main()
