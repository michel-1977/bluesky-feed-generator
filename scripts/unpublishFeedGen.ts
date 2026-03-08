import dotenv from 'dotenv'
import inquirer from 'inquirer'
import { AtpAgent } from '@atproto/api'
import { ids } from '../src/lexicon/lexicons'

const run = async () => {
  dotenv.config()

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'handle',
      message: 'Enter your Bluesky handle:',
      required: true,
    },
    {
      type: 'password',
      name: 'password',
      message: 'Enter your Bluesky app password:',
      required: true,
    },
    {
      type: 'input',
      name: 'service',
      message: 'PDS service URL:',
      default: 'https://bsky.social',
      required: false,
    },
    {
      type: 'input',
      name: 'recordName',
      message: 'Record name (rkey) to delete:',
      default: process.env.FEEDGEN_FEED_SHORTNAME ?? 'mobility-risk',
      required: true,
    },
    {
      type: 'confirm',
      name: 'confirm',
      message:
        'Delete this feed record? Existing likes/subscriptions to this record will be lost.',
      default: false,
    },
  ])

  const { handle, password, recordName, service, confirm } = answers

  if (!confirm) {
    console.log('Aborted.')
    return
  }

  const agent = new AtpAgent({ service: service || 'https://bsky.social' })
  await agent.login({ identifier: handle, password })

  await agent.api.com.atproto.repo.deleteRecord({
    repo: agent.session?.did ?? '',
    collection: ids.AppBskyFeedGenerator,
    rkey: recordName,
  })

  console.log('Feed record deleted successfully.')
}

run().catch((err) => {
  console.error('Failed to delete feed record', err)
  process.exit(1)
})
