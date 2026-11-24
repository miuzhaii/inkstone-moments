import { describe, expect, it } from 'vitest'
import {
  deriveMomentsPreview,
  extractAttachmentIds,
  extractMarkdownImages,
  extractTags,
  rewriteShareImageUrl,
} from './markdown-utils'

describe('extractTags', () => {
  it('handles an unterminated inline-code marker with a mismatched trailing marker', () => {
    expect(extractTags('` #visible ``')).toEqual(['visible'])
  })

  it('does not treat tags in complete inline code or fenced blocks as tags', () => {
    expect(extractTags('`#inline`\n```\n#fenced\n```\n#visible')).toEqual(['visible'])
  })
})

describe('extractAttachmentIds', () => {
  const idA = '01m1r8923zajxnw9y0dhs6sy8j'
  const idB = '01m1r9qq6zb99ef3cqkjrzrn89'

  it('collects plain and angle-bracket references outside code regions', () => {
    expect(extractAttachmentIds(
      `![a](/api/files/${idA})\n\n![b](</api/files/${idB} "t">)`,
    )).toEqual([idA, idB])
  })

  it('ignores references inside ordinary fenced code', () => {
    expect(extractAttachmentIds(
      '```\n![a](/api/files/' + idA + ')\n```\n![b](/api/files/' + idB + ')',
    )).toEqual([idB])
  })

  it('collects references inside md-example fences, which render as live markdown', () => {
    expect(extractAttachmentIds(
      `~~~~md-example title="Image"\n![a](</api/files/${idA} "a">)\n~~~~`,
    )).toEqual([idA])
  })

  it('keeps stripping nested ordinary code inside an md-example fence', () => {
    expect(extractAttachmentIds(
      `~~~~md-example\n\`\`\`\n![a](/api/files/${idA})\n\`\`\`\n![b](/api/files/${idB})\n~~~~`,
    )).toEqual([idB])
  })

  it('accepts the markdown-example alias', () => {
    expect(extractAttachmentIds(
      `~~~markdown-example\n![a](/api/files/${idA})\n~~~`,
    )).toEqual([idA])
  })

  it('does not close an md-example fence on a marker followed by text', () => {
    expect(extractAttachmentIds(
      `~~~~md-example\n![a](/api/files/${idA})\n~~~~ trailing\n![b](/api/files/${idB})`,
    )).toEqual([idA])
  })

  it('collects absolute attachment URLs', () => {
    expect(extractAttachmentIds(`![a](https://inkstone.example.com/api/files/${idA})`)).toEqual([idA])
  })

  it('does not close ordinary fences on markers followed by text', () => {
    expect(extractAttachmentIds(
      `\`\`\`text\nexample\n\`\`\`not-a-close\nmore code\n\`\`\`\n![b](/api/files/${idB})`,
    )).toEqual([idB])
  })

  it('ignores md-example markers inside ordinary code fences', () => {
    expect(extractAttachmentIds(`~~~~text\n\`\`\`md-example\n![a](/api/files/${idA})\n\`\`\`\n~~~~`)).toEqual([])
  })
})

describe('extractMarkdownImages', () => {
  const idA = '01m1r8923zajxnw9y0dhs6sy8j'

  it('extracts markdown and HTML images in document order while skipping code blocks and unsafe URLs', () => {
    const content = [
      '---',
      'tags: [blog]',
      '---',
      '![first](/api/files/' + idA + ' "caption")',
      '```md',
      '![ignored](https://example.com/code.png)',
      '```',
      '<img src="https://example.com/photo.jpg" alt="Sunset" />',
      '![bad](javascript:alert(1))',
      '![dup](/api/files/' + idA + ')',
    ].join('\n')

    expect(extractMarkdownImages(content)).toEqual([
      { src: `/api/files/${idA}`, alt: 'first' },
      { src: 'https://example.com/photo.jpg', alt: 'Sunset' },
    ])
  })

  it('rewrites attachment URLs with share slug and leaves external URLs untouched', () => {
    expect(rewriteShareImageUrl(`/api/files/${idA}`, 'abc123')).toBe(`/api/files/${idA}?share=abc123`)
    expect(rewriteShareImageUrl('https://example.com/a.png', 'abc123')).toBe('https://example.com/a.png')
  })
})

describe('deriveMomentsPreview', () => {
  it('strips duplicate leading title, image lines, and standalone tag lines', () => {
    const content = [
      '# Weekend Walk',
      '',
      'Morning light by the lake.',
      '',
      '![lake](/api/files/01m1r8923zajxnw9y0dhs6sy8j)',
      '',
      '#life #photo',
    ].join('\n')

    expect(deriveMomentsPreview(content, 'Weekend Walk')).toEqual({
      text: 'Morning light by the lake.',
      truncated: false,
      hasRichBlocks: false,
    })
  })

  it('flags rich blocks and truncates long multi-line posts', () => {
    const content = [
      'Line 1',
      'Line 2',
      'Line 3',
      'Line 4',
      'Line 5',
      'Line 6',
      'Line 7',
      '```ts',
      'const x = 1',
      '```',
    ].join('\n')

    const result = deriveMomentsPreview(content, '')
    expect(result.truncated).toBe(true)
    expect(result.hasRichBlocks).toBe(true)
    expect(result.text.endsWith('…')).toBe(true)
  })
})
