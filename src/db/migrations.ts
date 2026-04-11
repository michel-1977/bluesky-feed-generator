import { Kysely, Migration, MigrationProvider } from 'kysely'

const migrations: Record<string, Migration> = {}

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations
  },
}

migrations['001'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('post')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('cid', 'varchar', (col) => col.notNull())
      .addColumn('author', 'varchar', (col) => col.notNull())
      .addColumn('text', 'varchar', (col) => col.notNull())
      .addColumn('langs', 'varchar', (col) => col.notNull().defaultTo(''))
      .addColumn('indexedAt', 'varchar', (col) => col.notNull())
      .execute()

    await db.schema
      .createIndex('post_indexed_at_idx')
      .on('post')
      .column('indexedAt')
      .execute()

    await db.schema
      .createTable('sub_state')
      .addColumn('service', 'varchar', (col) => col.primaryKey())
      .addColumn('cursor', 'integer', (col) => col.notNull())
      .execute()
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('post').execute()
    await db.schema.dropTable('sub_state').execute()
  },
}

migrations['002'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('filter_metric')
      .addColumn('metric', 'varchar', (col) => col.primaryKey())
      .addColumn('count', 'integer', (col) => col.notNull().defaultTo(0))
      .execute()
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('filter_metric').execute()
  },
}

migrations['003'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .alterTable('post')
      .addColumn('score', 'integer', (col) => col.notNull().defaultTo(0))
      .execute()

    await db.schema
      .alterTable('post')
      .addColumn('sourceTier', 'varchar', (col) => col.notNull().defaultTo('neutral'))
      .execute()

    await db.schema
      .alterTable('post')
      .addColumn('decisionReason', 'varchar', (col) => col.notNull().defaultTo('legacy'))
      .execute()

    await db.schema
      .alterTable('post')
      .addColumn('filterVersion', 'varchar', (col) =>
        col.notNull().defaultTo('legacy-v0'),
      )
      .execute()

    await db.schema
      .createIndex('post_filter_version_idx')
      .on('post')
      .column('filterVersion')
      .execute()
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropIndex('post_filter_version_idx').execute()
    await db.schema.alterTable('post').dropColumn('filterVersion').execute()
    await db.schema.alterTable('post').dropColumn('decisionReason').execute()
    await db.schema.alterTable('post').dropColumn('sourceTier').execute()
    await db.schema.alterTable('post').dropColumn('score').execute()
  },
}
