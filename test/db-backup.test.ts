import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDb, Database, migrateToLatest } from '../src/db'

describe('sqlite backup persistence', () => {
  const tempRoots: string[] = []
  let db: Database | undefined

  afterEach(async () => {
    await db?.destroy()
    db = undefined

    for (const tempRoot of tempRoots.splice(0)) {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('restores the persistent backup into a fresh local sqlite file', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'feedgen-db-'))
    tempRoots.push(tempRoot)

    const runtimeLocation = path.join(tempRoot, 'runtime', 'db.sqlite')
    const backupLocation = path.join(tempRoot, 'persisted', 'db.sqlite')

    db = createDb(runtimeLocation, {
      backupLocation,
      backupDebounceMs: 1,
    })
    await migrateToLatest(db)

    await db
      .insertInto('post')
      .values({
        uri: 'at://persisted-post',
        cid: 'cid-1',
        author: 'did:plc:test',
        text: 'Atropello con desvio en Logrono',
        langs: 'es',
        indexedAt: '2026-04-11T12:00:00.000Z',
        score: 90,
        sourceTier: 'trusted',
        decisionReason: 'rule_accept:test',
        filterVersion: 'precision-v1',
      })
      .execute()

    db.scheduleBackup()
    await db.flushBackup()
    await db.destroy()
    db = undefined

    const restoredLocation = path.join(tempRoot, 'restored', 'db.sqlite')
    db = createDb(restoredLocation, {
      backupLocation,
      backupDebounceMs: 1,
    })
    await migrateToLatest(db)

    const restoredPost = await db
      .selectFrom('post')
      .selectAll()
      .where('uri', '=', 'at://persisted-post')
      .executeTakeFirst()

    expect(restoredPost?.text).toBe('Atropello con desvio en Logrono')
  })
})
