// Time and task formatting utilities

/** Format a date as relative time (Chinese locale) */
export function formatRelativeTime(date: string | Date): string {
    if (!date) return ''
    const d = new Date(date)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes}分钟前`
    if (hours < 24) return `${hours}小时前`
    if (days < 7) return `${days}天前`
    return d.toLocaleDateString('zh-CN')
}

/** Format a date as a localized datetime string (zh-CN) */
export function formatDateTime(date: string | Date): string {
    if (!date) return ''
    const d = new Date(date)
    return d.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    })
}

/** Humanize a cron expression into Chinese description */
export function humanizeCron(expr: string): string {
    const parts = expr.split(' ')
    if (parts.length !== 5) return expr
    const [min, hour, day, month, weekday] = parts
    const isNumeric = (s: string) => /^\d+$/.test(s)

    // Every N minutes: */N * * * *
    if (min.startsWith('*/') && hour === '*') return `每 ${min.slice(2)} 分钟`
    // Every N hours: 0 */N * * *
    if (hour.startsWith('*/') && day === '*' && month === '*' && weekday === '*') return `每 ${hour.slice(2)} 小时`

    const timeStr = isNumeric(hour) ? `${hour}:${min.padStart(2, '0')}` : ''

    // Hourly at minute M: M * * * *
    if (isNumeric(min) && hour === '*' && day === '*' && month === '*' && weekday === '*') {
        return `每小时 :${min.padStart(2, '0')}`
    }
    // Daily: M H * * *
    if (isNumeric(min) && isNumeric(hour) && day === '*' && month === '*' && weekday === '*') {
        return `每天 ${timeStr}`
    }
    // Weekly: M H * * DOW
    const weekdayNames = ['日', '一', '二', '三', '四', '五', '六']
    if (isNumeric(min) && isNumeric(hour) && day === '*' && month === '*') {
        if (weekday === '1-5') return `工作日 ${timeStr}`
        if (isNumeric(weekday)) return `每周${weekdayNames[parseInt(weekday)]} ${timeStr}`
    }
    // Monthly: M H D * *
    if (isNumeric(min) && isNumeric(hour) && isNumeric(day) && month === '*' && weekday === '*') {
        return `每月${day}日 ${timeStr}`
    }

    return expr
}

/** Get a Chinese label for task repeat mode */
export function repeatLabel(mode: string, maxRuns: number): string {
    if (mode === 'once') return '单次'
    if (mode === 'limited') return `${maxRuns}次`
    return '不限'
}

/** Get a Chinese label for task status */
export function statusLabel(status: string): string {
    if (status === 'active') return '运行中'
    if (status === 'paused') return '已暂停'
    if (status === 'completed') return '已完成'
    return status
}
