import { createApp } from 'vue'
import App from './App.vue'
import i18n from './i18n'
import { marked, hljs } from './utils/globals.ts'
import { slugify } from './utils/toc.ts'
import { escapeHtml } from './utils/html.ts'

// Configure marked (moved from inline script in index.html)
marked.use({
    renderer: {
        heading(token: { text?: string; depth: number }): string {
            const text = marked.parseInline(token.text || '')
            const level = token.depth
            const id = slugify(token.text || '')
            return `<h${level} id="${id}">${text}</h${level}>`
        },
        code(token: { text?: string; lang?: string }): string {
            const code = token.text || ''
            const lang = token.lang || ''
            if (lang === 'mermaid') {
                return '<pre class="mermaid">' + escapeHtml(code) + '</pre>'
            }
            const langClass = lang ? ' class="language-' + lang + '"' : ''
            const highlighted = (lang && hljs.getLanguage(lang))
                ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
                : hljs.highlightAuto(code).value
            return '<pre><code' + langClass + '>' + highlighted + '</code></pre>'
        },
    },
})

createApp(App).use(i18n).mount('#app')
