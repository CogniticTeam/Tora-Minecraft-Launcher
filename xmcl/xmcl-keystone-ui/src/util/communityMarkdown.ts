import MarkdownIt from 'markdown-it'
const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true }).disable('image')
const fence = markdown.renderer.rules.fence!
markdown.renderer.rules.fence = (...args) => `<div class="community-code"><span class="community-code-actions"></span>${fence(...args)}</div>`
export function renderCommunityMarkdown(text: string) { return markdown.render(text) }
