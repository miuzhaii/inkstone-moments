import { t } from '../../lib/i18n'

export function preparePublicMarkdownHtml(
  html: string,
  slug: string,
  options: { hideFrontMatter?: boolean } = {},
): string {
  const template = document.createElement('template')
  template.innerHTML = html

  if (options.hideFrontMatter) {
    for (const block of template.content.querySelectorAll('.frontmatter-properties, .frontmatter-error')) {
      block.remove()
    }
  }

  for (const embed of template.content.querySelectorAll<HTMLElement>('.note-embed[data-embed-target]')) {
    embed.removeAttribute('data-embed-target')
    embed.classList.remove('loading')
    embed.classList.add('error')
    const body = embed.querySelector<HTMLElement>('.note-embed-body')
    if (body) {
      body.removeAttribute('aria-busy')
      body.textContent = t('share.embedded_private_notes_are_not_included_in_public_shares')
    }
  }

  for (const task of template.content.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox')) {
    task.disabled = true
    task.removeAttribute('data-task-line')
    task.setAttribute('aria-label', t('share.tasks_in_public_shares_are_read_only'))
  }

  for (const element of template.content.querySelectorAll<HTMLImageElement | HTMLAnchorElement>('img[src], a[href]')) {
    const attr = element instanceof HTMLImageElement ? 'src' : 'href'
    const raw = element.getAttribute(attr)
    if (!raw) continue
    try {
      const url = new URL(raw, window.location.origin)
      if (
        url.origin !== window.location.origin ||
        !/^\/api\/files\/[0-9a-hjkmnp-tv-z]{26}$/i.test(url.pathname)
      ) {
        continue
      }
      url.searchParams.set('share', slug)
      element.setAttribute(attr, `${url.pathname}${url.search}`)
    } catch {
    }
  }

  return template.innerHTML
}
