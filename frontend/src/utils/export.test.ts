import { describe, expect, it, vi } from 'vitest'
import { idleExportProgress, runExportWithProgress, toCSV } from './export'

describe('export utils', () => {
    it('builds csv with headers', () => {
        const csv = toCSV([{ a: 1, b: 'x,y' }], ['a', 'b'])
        expect(csv).toContain('a,b')
        expect(csv).toContain('"x,y"')
    })

    it('reports progress phases through a successful export', async () => {
        const phases: string[] = []
        await runExportWithProgress(
            {
                preparing: 'prep',
                downloading: 'down',
                complete: 'done',
            },
            (state) => phases.push(state.phase),
            async () => 'ok',
        )
        expect(phases).toEqual(['preparing', 'downloading', 'complete'])
    })

    it('sets error phase when export fails', async () => {
        const onProgress = vi.fn()
        await expect(
            runExportWithProgress(
                { preparing: 'p', downloading: 'd', complete: 'c' },
                onProgress,
                async () => {
                    throw new Error('network down')
                },
            ),
        ).rejects.toThrow('network down')
        expect(onProgress).toHaveBeenCalledWith(
            expect.objectContaining({ phase: 'error', detail: 'network down' }),
        )
    })

    it('starts in idle', () => {
        expect(idleExportProgress().phase).toBe('idle')
    })
})
