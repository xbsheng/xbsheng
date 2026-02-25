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

    let totalEvents = 0
    let pushEventCount = 0

    for (let page = 1; page <= 3; page++) {
      const { data: events } = await octokit.activity.listEventsForAuthenticatedUser({
        username,
        per_page: 100,
        page,
      })

      console.log(`Page ${page}: fetched ${events.length} events`)
      if (events.length === 0) break
      totalEvents += events.length

      for (const event of events) {
        if (event.type === 'PushEvent') {
          pushEventCount++

          if (pushEventCount <= 3) {
            console.log(`🔍 PushEvent #${pushEventCount} payload keys: ${Object.keys(event.payload || {})}`)
            console.log(`   payload.size=${event.payload?.size}, payload.distinct_size=${event.payload?.distinct_size}`)
            console.log(`   payload.commits type=${typeof event.payload?.commits}, isArray=${Array.isArray(event.payload?.commits)}, length=${event.payload?.commits?.length}`)
            console.log(`   event.created_at=${event.created_at}, repo=${event.repo?.name}`)
          }

          const payload = event.payload || {}
          const commitCount = (Array.isArray(payload.commits) && payload.commits.length > 0)
            ? payload.commits.length
            : (payload.size || payload.distinct_size || 1)
          stats.total += commitCount

          const utcTime = new Date(event.created_at)
          const beijingTime = utcToZonedTime(utcTime, TIME_ZONE)
          const hour = beijingTime.getHours()

          if (hour >= 6 && hour < 12) {
            stats.morning += commitCount
          } else if (hour >= 12 && hour < 18) {
            stats.daytime += commitCount
          } else if (hour >= 18 && hour < 24) {
            stats.evening += commitCount
          } else {
            stats.night += commitCount
          }
        }
      }
    }

    console.log(`📊 Total events: ${totalEvents}, PushEvents: ${pushEventCount}, Commits: ${stats.total}`)
    if (totalEvents === 0) {
      console.warn('⚠️  No events found. Token likely needs broader permissions:')
      console.warn('   - Fine-grained PAT: set Repository access to "All repositories"')
      console.warn('   - Or use a Classic PAT with "repo" + "gist" scopes')
    }

    return stats
  } catch (error) {
    console.error('Failed to get commit data: ', error.message)
    if (error.status === 401 || error.status === 403) {
      console.error('🔑 Token authentication failed. Check GIST_TOKEN in repository secrets.')
    }
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
      const col4 = `${String(percent).padStart(5)}%`
      return `${col1}   ${col2}   ${col3}   ${col4}`
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
