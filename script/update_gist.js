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
    const { data: events } = await octokit.activity.listPublicEventsForUser({
      username: GH_USERNAME,
      per_page: 100,
    })

    const stats = {
      morning: 0, // Beijing Time 6-12 AM
      daytime: 0, // Beijing Time 12-6 PM
      evening: 0, // Beijing Time 6-12 PM
      night: 0, // Beijing Time 12-6 AM
      total: 0,
    }

    for (const event of events) {
      if (event.type === 'PushEvent') {
        const commits = event.payload?.commits || []
        const commitCount = commits.length
        stats.total += commitCount

        // Convert UTC time to Beijing Time
        const utcTime = new Date(event.created_at)
        const beijingTime = utcToZonedTime(utcTime, TIME_ZONE)
        const hour = beijingTime.getHours()

        // Count by Beijing Time hour
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
    const filled = Math.round(percent / 5) // 每5%填充一个方块，总长度20个
    return '█'.repeat(filled) + '░'.repeat(20 - filled)
  }

  // Show update time in Beijing Time
  const now = new Date()
  const beijingNow = utcToZonedTime(now, TIME_ZONE)
  const updateTime = format(beijingNow, 'yyyy-MM-dd HH:mm:ss', { timeZone: TIME_ZONE })

  return `🌞 Morning    ${stats.morning} commits    ${getBar(getPercent(stats.morning))}    ${getPercent(stats.morning)}%
🏙️ Daytime    ${stats.daytime} commits    ${getBar(getPercent(stats.daytime))}    ${getPercent(stats.daytime)}%
🌆 Evening    ${stats.evening} commits    ${getBar(getPercent(stats.evening))}    ${getPercent(stats.evening)}%
🌙 Night      ${stats.night} commits    ${getBar(getPercent(stats.night))}    ${getPercent(stats.night)}%
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
