// API utility functions
import i18n from '@/i18n'

function localeHeaders(): Record<string, string> {
    return { 'X-Locale': i18n.global.locale.value as string }
}

export async function apiGet<T = unknown>(url: string): Promise<T> {
    const resp = await fetch(url, { headers: localeHeaders() })
    if (!resp.ok) throw new Error(await resp.text())
    return resp.json()
}

export async function apiPost<T = unknown>(url: string, body: unknown): Promise<T> {
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...localeHeaders() },
        body: JSON.stringify(body),
    })
    const data = await resp.json().catch(() => ({})) as Record<string, unknown>
    if (!resp.ok) throw new Error(data.error ? String(data.error) : resp.statusText)
    return data as T
}

export async function apiDelete<T = unknown>(url: string): Promise<T> {
    const resp = await fetch(url, { method: 'DELETE', headers: localeHeaders() })
    if (!resp.ok) throw new Error(resp.statusText)
    return resp.json()
}

export async function cancelChat(sessionId: string): Promise<void> {
    const resp = await fetch(`/api/ai/chat/cancel?session_id=${encodeURIComponent(sessionId)}`, {
        method: 'POST',
        headers: localeHeaders(),
    })
    if (!resp.ok) throw new Error(resp.statusText)
}
