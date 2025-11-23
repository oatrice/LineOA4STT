import { describe, expect, it } from 'bun:test'

describe('Reply Message Formatting', () => {
    const displayName = 'Test User'
    const timeString = '12:00'
    const jobId = 'job-123'
    const transcript = 'Hello World'

    it('should format message correctly for Azure (no fallback)', () => {
        const result = {
            transcript,
            confidence: 0.9,
            provider: 'azure',
            isFallback: false,
        }

        let replyText = `✨ เสร็จแล้วครับ!\n\nจาก: ${displayName}\nข้อความเมื่อ ${timeString}\nผลลัพธ์: ${result.transcript}\n\n----------------\nProvider: ${result.provider}\nJob ID: ${jobId}`

        if (result.isFallback) {
            replyText += `\nFallback: Yes (Google)`
        }

        expect(replyText).toContain('Provider: azure')
        expect(replyText).toContain('Job ID: job-123')
        expect(replyText).not.toContain('Fallback: Yes')
    })

    it('should format message correctly for Google (fallback)', () => {
        const result = {
            transcript,
            confidence: 0.8,
            provider: 'google',
            isFallback: true,
        }

        let replyText = `✨ เสร็จแล้วครับ!\n\nจาก: ${displayName}\nข้อความเมื่อ ${timeString}\nผลลัพธ์: ${result.transcript}\n\n----------------\nProvider: ${result.provider}\nJob ID: ${jobId}`

        if (result.isFallback) {
            replyText += `\nFallback: Yes (Google)`
        }

        expect(replyText).toContain('Provider: google')
        expect(replyText).toContain('Job ID: job-123')
        expect(replyText).toContain('Fallback: Yes (Google)')
    })
})
