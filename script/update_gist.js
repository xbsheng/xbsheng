// 引入依赖
const { Octokit } = require('@octokit/rest')
const { format, utcToZonedTime } = require('date-fns-tz')

// 从环境变量获取配置
const GIST_TOKEN = process.env.GIST_TOKEN
const GIST_ID = process.env.GIST_ID
const GH_USERNAME = process.env.GH_USERNAME
const TIME_ZONE = 'Asia/Shanghai' // Beijing Timezone

// 初始化 Octokit 客户端
const octokit = new Octokit({
  auth: GIST_TOKEN,
  userAgent: 'Gist-Updater-Node.js',
})

/**
 * Step 1: Get and count commit time distribution (Beijing Time)
 */
async function getCommitTimes() {
  try {
    const { data: user } = await octokit.users.getAuthenticated()
    console.log(`✅ Authenticated as: ${user.login}`)

    const username = GH_USERNAME || user.login

    const stats = {
      morning: 0,
      daytime: 0,
      evening: 0,
      night: 0,
      total: 0,
    }

    const since = new Date()
    since.setDate(since.getDate() - 365)
    const sinceStr = since.toISOString().split('T')[0]

    for (let page = 1; page <= 10; page++) {
      const { data } = await octokit.request('GET /search/commits', {
        q: `author:${username} author-date:>${sinceStr}`,
        sort: 'author-date',
        order: 'desc',
        per_page: 100,
        page,
      })

      if (page === 1) {
        console.log(`🔍 Search found ${data.total_count} commits in the last year`)
      }

      const items = data.items || []
      if (items.length === 0) break

      for (const item of items) {
        const authorDate = new Date(item.commit.author.date)
        const beijingTime = utcToZonedTime(authorDate, TIME_ZONE)
        const hour = beijingTime.getHours()

        stats.total++
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

      if (items.length < 100) break
    }

    console.log(`📊 Counted ${stats.total} commits (Morning: ${stats.morning}, Daytime: ${stats.daytime}, Evening: ${stats.evening}, Night: ${stats.night})`)

    return stats
  } catch (error) {
    console.error('Failed to get commit data: ', error.message)
    throw error
  }
}

/**
 * Step 2: Generate content matching the screenshot style
 */
function generateMarkdown(stats) {
  const getPercent = num => (stats.total === 0 ? 0 : ((num / stats.total) * 100).toFixed(1))
  const getBar = percent => {
    const filled = Math.round(percent / 5)
    return '█'.repeat(filled) + '░'.repeat(20 - filled)
  }

  const now = new Date()
  const beijingNow = utcToZonedTime(now, TIME_ZONE)
  const updateTime = format(beijingNow, 'yyyy-MM-dd HH:mm:ss', { timeZone: TIME_ZONE })

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

/**
 * Step 3: Update Gist
 */
async function updateGist(content) {
  try {
    await octokit.gists.update({
      gist_id: GIST_ID,
      files: {
        'commit-habit.md': {
          content: content,
        },
      },
    })
    console.log('✅ Gist updated successfully!')
  } catch (error) {
    console.error('❌ Failed to update Gist: ', error.message)
    throw error
  }
}

/**
 * Main function
 */
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
