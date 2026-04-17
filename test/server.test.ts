import events from 'events'
import express from 'express'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDb, Database, migrateToLatest } from '../src/db'
import { FeedGenerator } from '../src/server'
import { FirehoseSubscription } from '../src/subscription'
import { createTestConfig } from './helpers'

describe('FeedGenerator.stop', () => {
  const tempRoots: string[] = []
  let restoredDb: Database | undefined

  afterEach(async () => {
    await restoredDb?.destroy()
    restoredDb = undefined

    for (const tempRoot of tempRoots.splice(0)) {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('flushes the sqlite backup before shutdown completes', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feedgen-stop-'))
    tempRoots.push(tempRoot)

    const runtimeLocation = path.join(tempRoot, 'runtime', 'db.sqlite')
    const backupLocation = path.join(tempRoot, 'persisted', 'db.sqlite')

    const db = createDb(runtimeLocation, {
      backupLocation,
      backupDebounceMs: 60000,
    })
    await migrateToLatest(db)

    await db
      .insertInto('post')
      .values({
        uri: 'at://pending-stop-flush',
        cid: 'cid-stop',
        author: 'did:plc:test',
        text: 'Accidente en Bilbao con carretera cortada',
        langs: 'es',
        indexedAt: '2026-04-17T17:00:00.000Z',
        score: 92,
        sourceTier: 'neutral',
        decisionReason: 'rule_accept:neutral:carretera cortada',
        filterVersion: 'precision-v1',
      })
      .execute()

    db.scheduleBackup()

    const feedGenerator = new FeedGenerator(
      express(),
      db,
      { stop: () => undefined } as unknown as FirehoseSubscription,
      createTestConfig({
        sqliteLocation: runtimeLocation,
        sqliteBackupLocation: backupLocation,
      }),
    )

    feedGenerator.server = feedGenerator.app.listen(0, '127.0.0.1')
    await events.once(feedGenerator.server, 'listening')

    await feedGenerator.stop()

    const restoredLocation = path.join(tempRoot, 'restored', 'db.sqlite')
    restoredDb = createDb(restoredLocation, {
      backupLocation,
      backupDebounceMs: 1,
    })
    await migrateToLatest(restoredDb)

    const row = await restoredDb
      .selectFrom('post')
      .select('uri')
      .where('uri', '=', 'at://pending-stop-flush')
      .executeTakeFirst()

    expect(row?.uri).toBe('at://pending-stop-flush')
  })
})
