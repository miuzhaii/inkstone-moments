import { webcrypto } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLIENT_HEADER } from '../src/shared/constants'
import { initializeDatabase, SCHEMA_STATEMENTS } from '../src/worker/db/schema'
import type { AppBindings, Env } from '../src/worker/env'
import { errorResponse } from '../src/worker/lib/errors'
import { createSession } from '../src/worker/lib/session-store'
import { loadSession, requireClientHeader } from '../src/worker/middleware/auth'
import {
  blogPageRoutes,
  renderBlogShell,
  renderNotebookShell,
  shareManageRoutes,
  sharePageRoutes,
  shareRoutes,
} from '../src/worker/routes/share'
import type { PublicBlogResponse, PublicNote, ShareInfo } from '../src/shared/types'

function createShareTestApp() {
  const app = new Hono<AppBindings>()
  app.onError((err, c) => errorResponse(c, err))
  app.use('/api/*', requireClientHeader)
  app.use('/api/*', loadSession)
  app.get('/', (c) => renderBlogShell(c, new URL(c.req.url)))
  app.get('/notes', (c) => renderNotebookShell(c, new URL(c.req.url)))
  app.route('/api/share', shareManageRoutes)
  app.route('/api/public', shareRoutes)
  app.route('/s', sharePageRoutes)
  app.route('/blog', blogPageRoutes)
  return app
}

let sqlite: DatabaseSync
let db: D1Database

function createD1Mock(instance: DatabaseSync): D1Database {
  const makePrepared = (sql: string) => {
    let values: unknown[] = []
    const runArgs = () =>
      values.length
        ? [Object.fromEntries(values.map((value, index) => [String(index + 1), value]))]
        : []
    const isQuery = () => /^\s*(?:SELECT|PRAGMA|WITH)\b/i.test(sql)
    const prepared = {
      bind(...bound: unknown[]) {
        values = bound
        return prepared
      },
      async first<T>() {
        const statement = instance.prepare(sql)
        return (statement.get(...(runArgs() as never[])) as T | undefined) ?? null
      },
      async all<T>() {
        const statement = instance.prepare(sql)
        return { results: statement.all(...(runArgs() as never[])) as T[] }
      },
      async run() {
        const statement = instance.prepare(sql)
        const result = statement.run(...(runArgs() as never[]))
        return { meta: { changes: Number(result.changes) } }
      },
      async execBatch() {
        if (isQuery()) return prepared.all()
        return prepared.run()
      },
    }
    return prepared
  }
  return {
    prepare: makePrepared,
    async batch(statements: Array<{ execBatch: () => Promise<unknown> }>) {
      const results: unknown[] = []
      for (const statement of statements) {
        results.push(await statement.execBatch())
      }
      return results
    },
  } as unknown as D1Database
}

const mockExecCtx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext

function createEnv(database: D1Database): Env {
  return {
    DB: database,
    APP_NAME: 'Inkstone Blog',
    ASSETS: {
      async fetch() {
        return new Response(
          '<!doctype html><html><head><title>Inkstone</title><link rel="icon" href="/default.svg" /><link rel="apple-touch-icon" href="/apple-touch-icon.png" /></head><body></body></html>',
          {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          },
        )
      },
    } as unknown as Fetcher,
  }
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  sqlite = new DatabaseSync(':memory:')
  db = createD1Mock(sqlite)
})

afterEach(() => {
  sqlite.close()
  vi.unstubAllGlobals()
})

describe('blog moments API, encrypted moments, anti-brute-force, and branding shells', () => {
  it('migrates an existing shares table without listed and likes columns via migrations 14 and 15', async () => {
    const legacyStatements = SCHEMA_STATEMENTS.filter((statement) => !statement.includes('idx_shares_listed')).map(
      (statement) =>
        statement.includes('CREATE TABLE IF NOT EXISTS shares')
          ? statement.replace('likes INTEGER NOT NULL DEFAULT 0,\n    listed INTEGER NOT NULL DEFAULT 0,\n    ', '')
          : statement,
    )
    sqlite.exec(legacyStatements.join(';'))
    sqlite.prepare(`INSERT INTO users (id, username, password_hash, login, name, avatar_url, role, settings, created_at, last_seen_at) VALUES ('u1', 'owner', 'hash', 'owner', 'Alice', '', 'owner', '{}', 1, 1)`).run()
    sqlite.prepare(`INSERT INTO notes (id, user_id, title, content, created_at, updated_at) VALUES ('n1', 'u1', 'Legacy', 'Hello', 1, 1)`).run()
    sqlite.prepare(`INSERT INTO shares (slug, note_id, user_id, created_at) VALUES ('legacy1', 'n1', 'u1', 100)`).run()

    const state = await initializeDatabase(createEnv(db))
    expect(state.ftsEnabled).toBe(true)

    const row = sqlite.prepare(`SELECT listed, likes FROM shares WHERE slug = 'legacy1'`).get() as {
      listed: number
      likes: number
    }
    expect(row.listed).toBe(0)
    expect(row.likes).toBe(0)
  })

  it('supports public and encrypted Moments with zero content leak, brute-force lockout, and synced SSR branding', async () => {
    const env = createEnv(db)
    await initializeDatabase(env)
    const app = createShareTestApp()
    const now = Date.now()
    const attachmentId = '01m1r8923zajxnw9y0dhs6sy8j'

    sqlite
      .prepare(`INSERT INTO users (id, username, password_hash, login, name, avatar_url, role, settings, created_at, last_seen_at) VALUES ('u1', 'owner', 'hash', 'owner', 'Alice', 'dicebear:0123456789abcdef0123456789abcdef', 'owner', '{}', 1, 1)`)
      .run()

    const insertNote = sqlite.prepare(
      `INSERT INTO notes (id, user_id, title, title_key, content, excerpt, word_count, is_pinned, created_at, updated_at, deleted_at)
       VALUES (?, 'u1', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    insertNote.run(
      'n1',
      'Pinned Moment',
      'pinned moment',
      `# Pinned Moment\n\nCoffee by the window.\n\n![cup](/api/files/${attachmentId})\n![sky](https://example.com/sky.jpg)\n\n#life`,
      'Coffee by the window.',
      20,
      1,
      now - 5000,
      now - 4000,
      null,
    )
    insertNote.run(
      'n2',
      'Code Note',
      'code note',
      'Quick snippet\n\n```ts\nconsole.log(1)\n```\n\n#tech',
      'Quick snippet',
      15,
      0,
      now - 3000,
      now - 2000,
      null,
    )
    insertNote.run(
      'n3',
      'Encrypted Album',
      'encrypted album',
      `TopSecretBodyPhrase123\n\n![private](/api/files/${attachmentId})\n\n#secret`,
      'TopSecretBodyPhrase123',
      10,
      0,
      now - 2000,
      now - 1000,
      null,
    )
    insertNote.run(
      'n4',
      'Expired Post',
      'expired post',
      'Old content',
      'Old',
      10,
      0,
      now - 1000,
      now - 1000,
      null,
    )
    insertNote.run(
      'n5',
      'Trashed Post',
      'trashed post',
      'Deleted',
      'Deleted',
      10,
      0,
      now - 1000,
      now - 1000,
      now - 500,
    )
    insertNote.run(
      'n6',
      'Unlisted Share',
      'unlisted share',
      'Direct link only',
      'Direct link only',
      8,
      0,
      now - 900,
      now - 900,
      null,
    )

    sqlite.prepare(`INSERT INTO tags (id, user_id, name, created_at) VALUES ('t1', 'u1', 'life', 1), ('t2', 'u1', 'tech', 1), ('t3', 'u1', 'secret', 1)`).run()
    sqlite.prepare(`INSERT INTO note_tags (note_id, tag_id) VALUES ('n1', 't1'), ('n2', 't2'), ('n3', 't3')`).run()

    const sessionToken = await createSession(db, 'u1')
    const authHeaders = {
      Cookie: `inkstone_session=${sessionToken}`,
      [CLIENT_HEADER]: '1',
      'Content-Type': 'application/json',
    }

    const share1Res = await app.request(
      'http://localhost/api/share/n1',
      { method: 'POST', headers: authHeaders, body: JSON.stringify({ listed: true }) },
      env,
      mockExecCtx,
    )
    expect(share1Res.status).toBe(200)
    const share1 = ((await share1Res.json()) as { share: ShareInfo }).share
    expect(share1.listed).toBe(true)

    const share2Res = await app.request(
      'http://localhost/api/share/n2',
      { method: 'POST', headers: authHeaders, body: JSON.stringify({ listed: true }) },
      env,
      mockExecCtx,
    )
    const share2 = ((await share2Res.json()) as { share: ShareInfo }).share
    expect(share2.listed).toBe(true)

    const share3Res = await app.request(
      'http://localhost/api/share/n3',
      { method: 'POST', headers: authHeaders, body: JSON.stringify({ listed: true, password: 'secret123' }) },
      env,
      mockExecCtx,
    )
    const share3 = ((await share3Res.json()) as { share: ShareInfo }).share
    expect(share3.hasPassword).toBe(true)
    expect(share3.listed).toBe(true)

    const share6Res = await app.request(
      'http://localhost/api/share/n6',
      { method: 'POST', headers: authHeaders, body: JSON.stringify({ listed: false }) },
      env,
      mockExecCtx,
    )
    const share6 = ((await share6Res.json()) as { share: ShareInfo }).share
    expect(share6.listed).toBe(false)

    sqlite.prepare(`INSERT INTO shares (slug, note_id, user_id, expires_at, listed, created_at) VALUES ('expired1', 'n4', 'u1', ?, 1, ?)`).run(now - 100, now - 500)
    sqlite.prepare(`INSERT INTO shares (slug, note_id, user_id, listed, created_at) VALUES ('trashed1', 'n5', 'u1', 1, ?)`).run(now - 400)

    const feedRes = await app.request('http://localhost/api/public/blog', {}, env)
    expect(feedRes.status).toBe(200)
    const feed = (await feedRes.json()) as PublicBlogResponse
    expect(feed.profile.name).toBe('Alice')
    expect(feed.profile.totalPosts).toBe(3)
    expect(feed.tags.map((item) => item.name)).toEqual(['life', 'secret', 'tech'])
    expect(feed.posts.map((item) => item.slug)).toContain(share3.slug)
    expect(feed.posts.map((item) => item.slug)).not.toContain(share6.slug)

    const lockedPost = feed.posts.find((item) => item.slug === share3.slug)!
    expect(lockedPost.locked).toBe(true)
    expect(lockedPost.title).toBe('Encrypted Album')
    expect(lockedPost.previewText).toBe('')
    expect(lockedPost.images).toEqual([])
    expect(lockedPost.imageCount).toBe(1)

    const probeSearchRes = await app.request(
      'http://localhost/api/public/blog?q=TopSecretBodyPhrase123',
      {},
      env,
    )
    const probeSearch = (await probeSearchRes.json()) as PublicBlogResponse
    expect(probeSearch.posts).toHaveLength(0)

    const titleSearchRes = await app.request(
      'http://localhost/api/public/blog?q=Encrypted%20Album',
      {},
      env,
    )
    const titleSearch = (await titleSearchRes.json()) as PublicBlogResponse
    expect(titleSearch.posts.map((post) => post.slug)).toEqual([share3.slug])

    const noPwdRes = await app.request(
      `http://localhost/api/public/${share3.slug}`,
      {
        method: 'POST',
        headers: { [CLIENT_HEADER]: '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
      env,
      mockExecCtx,
    )
    expect(noPwdRes.status).toBe(401)

    for (let attempt = 1; attempt <= 5; attempt++) {
      const wrongRes = await app.request(
        `http://localhost/api/public/${share3.slug}`,
        {
          method: 'POST',
          headers: {
            [CLIENT_HEADER]: '1',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ password: `wrong-${attempt}` }),
        },
        env,
        mockExecCtx,
      )
      expect(wrongRes.status).toBe(401)
    }

    const lockedOutRes = await app.request(
      `http://localhost/api/public/${share3.slug}`,
      {
        method: 'POST',
        headers: {
          [CLIENT_HEADER]: '1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: 'secret123' }),
      },
      env,
      mockExecCtx,
    )
    expect(lockedOutRes.status).toBe(429)
    expect(Number(lockedOutRes.headers.get('Retry-After'))).toBeGreaterThan(0)
    const lockedOutBody = (await lockedOutRes.json()) as {
      error: { code: string; details?: { retryAfter?: number } }
    }
    expect(lockedOutBody.error.code).toBe('too_many_attempts')
    expect(lockedOutBody.error.details?.retryAfter).toBeGreaterThan(0)

    const futureTime = Date.now() + 65_000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(futureTime)
    const validUnlockRes = await app.request(
      `http://localhost/api/public/${share3.slug}`,
      {
        method: 'POST',
        headers: {
          [CLIENT_HEADER]: '1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: 'secret123' }),
      },
      env,
      mockExecCtx,
    )
    nowSpy.mockRestore()
    expect(validUnlockRes.status).toBe(200)
    expect(validUnlockRes.headers.get('Set-Cookie')).toContain('HttpOnly')
    const unlockedNote = (await validUnlockRes.json()) as PublicNote
    expect(unlockedNote.content).toContain('TopSecretBodyPhrase123')

    const privateShareHtmlRes = await app.request(`http://localhost/s/${share3.slug}`, {}, env)
    expect(privateShareHtmlRes.headers.get('X-Robots-Tag')).toBe('noindex')
    const privateShareHtml = await privateShareHtmlRes.text()
    expect(privateShareHtml).toContain('<title>Inkstone Blog</title>')

    const likeRes = await app.request(
      `http://localhost/api/public/blog/${share3.slug}/like`,
      {
        method: 'POST',
        headers: { [CLIENT_HEADER]: '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'like' }),
      },
      env,
      mockExecCtx,
    )
    expect(likeRes.status).toBe(200)
    expect(await likeRes.json()).toEqual({ slug: share3.slug, likes: 1 })

    const saveAppearanceRes = await app.request(
      'http://localhost/api/share/blog-settings',
      {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({
          coverUrl: 'https://example.com/cover.webp',
          logoUrl: 'https://example.com/logo.png',
          title: 'Daily Feed',
          bio: 'Small notes from daily life',
        }),
      },
      env,
      mockExecCtx,
    )
    expect(saveAppearanceRes.status).toBe(200)

    const customHtmlRes = await app.request('http://localhost/', {}, env)
    const customHtml = await customHtmlRes.text()
    expect(customHtml).toContain('<title>Daily Feed · Inkstone Blog</title>')
    expect(customHtml).toContain('https://example.com/logo.png')
    expect(customHtml).toContain('https://example.com/cover.webp')

    const notesHtmlRes = await app.request('http://localhost/notes', {}, env)
    expect(notesHtmlRes.headers.get('X-Robots-Tag')).toBe('noindex')
    const notesHtml = await notesHtmlRes.text()
    expect(notesHtml).toContain('<title>Inkstone Blog</title>')
    expect(notesHtml).toContain('https://example.com/logo.png')

    const storedLogoId = '01m86nm95915g312z46yz9kphr'
    await app.request(
      'http://localhost/api/share/blog-settings',
      {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ logoUrl: `/api/blog-assets/r2/logo/${storedLogoId}.jpg` }),
      },
      env,
      mockExecCtx,
    )
    const roundedHtmlRes = await app.request('http://localhost/', {}, env)
    const roundedHtml = await roundedHtmlRes.text()
    expect(roundedHtml).toContain(`/api/blog-assets/favicon/r2/${storedLogoId}.jpg`)
  })
})
