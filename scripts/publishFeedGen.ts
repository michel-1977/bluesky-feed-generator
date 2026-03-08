import dotenv from 'dotenv'
import fs from 'fs/promises'
import inquirer from 'inquirer'
import { AtpAgent, BlobRef, AppBskyFeedDefs } from '@atproto/api'
import { ids } from '../src/lexicon/lexicons'

const run = async () => {
  dotenv.config()

  if (!process.env.FEEDGEN_SERVICE_DID && !process.env.FEEDGEN_HOSTNAME) {
    throw new Error('Please provide FEEDGEN_HOSTNAME or FEEDGEN_SERVICE_DID in .env')
  }

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
      message: 'Record name (rkey):',
      default: process.env.FEEDGEN_FEED_SHORTNAME ?? 'mobility-risk',
      required: true,
    },
    {
      type: 'input',
      name: 'displayName',
      message: 'Feed display name:',
      required: true,
    },
    {
      type: 'input',
      name: 'description',
      message: 'Feed description (optional):',
      required: false,
    },
    {
      type: 'input',
      name: 'avatar',
      message: 'Local avatar path (optional):',
      required: false,
    },
    {
      type: 'confirm',
      name: 'videoOnly',
      message: 'Set content mode to video?',
      default: false,
    },
  ])

  const {
    handle,
    password,
    recordName,
    displayName,
    description,
    avatar,
    service,
    videoOnly,
  } = answers

  const feedGenDid =
    process.env.FEEDGEN_SERVICE_DID ?? `did:web:${process.env.FEEDGEN_HOSTNAME}`

  const agent = new AtpAgent({ service: service || 'https://bsky.social' })
  await agent.login({ identifier: handle, password })

  let avatarRef: BlobRef | undefined
  if (avatar) {
    let encoding: string
    if (avatar.endsWith('png')) {
      encoding = 'image/png'
    } else if (avatar.endsWith('jpg') || avatar.endsWith('jpeg')) {
      encoding = 'image/jpeg'
    } else {
      throw new Error('Avatar must be .png, .jpg, or .jpeg')
    }

    const img = await fs.readFile(avatar)
    const blobRes = await agent.api.com.atproto.repo.uploadBlob(img, {
      encoding,
    })
    avatarRef = blobRes.data.blob
  }

  await agent.api.com.atproto.repo.putRecord({
    repo: agent.session?.did ?? '',
    collection: ids.AppBskyFeedGenerator,
    rkey: recordName,
    record: {
      did: feedGenDid,
      displayName,
      description,
      avatar: avatarRef,
      createdAt: new Date().toISOString(),
      contentMode: videoOnly
        ? AppBskyFeedDefs.CONTENTMODEVIDEO
        : AppBskyFeedDefs.CONTENTMODEUNSPECIFIED,
    },
  })

  console.log('Feed record published successfully.')
}

run().catch((err) => {
  console.error('Failed to publish feed record', err)
  process.exit(1)
})
