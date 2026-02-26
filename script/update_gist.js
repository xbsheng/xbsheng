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
const MAX_PAGES = 10
const PER_PAGE = 100
const BAR_WIDTH = 20
const SEARCH_API_LIMIT = MAX_PAGES * PER_PAGE

if (!GIST_TOKEN || !GIST_ID) {
  console.error('❌ Missing required env: GIST_TOKEN or GIST_ID')
  process.exit(1)
}

const octokit = new Octokit({
  auth: GIST_TOKEN,
  userAgent: 'Gist-Updater-Node.js',
})

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

  const since = new Date()
  since.setDate(since.getDate() - DAYS_LOOKBACK)
  const sinceStr = since.toISOString().split('T')[0]

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await octokit.request('GET /search/commits', {
      q: `author:${username} author-date:>${sinceStr}`,
      sort: 'author-date',
      order: 'desc',
      per_page: PER_PAGE,
      page,
    })

    if (page === 1) {
      console.log(`🔍 Search found ${data.total_count} commits in the last year`)
      if (data.total_count > SEARCH_API_LIMIT) {
        console.warn(`⚠️ Total ${data.total_count} commits, but Search API caps at ${SEARCH_API_LIMIT}`)
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
