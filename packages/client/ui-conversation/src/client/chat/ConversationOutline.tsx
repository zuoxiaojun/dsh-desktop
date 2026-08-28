import { useEffect, useMemo, useRef, useState } from 'react'
import {
  IconChevronRightOutline14, IconCloseOutline16, IconListPenOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { ConversationOutlineEntry } from './outline.ts'
import css from './ConversationOutline.module.css'

const ROW_HEIGHT = 48
const VIEWPORT_HEIGHT = 336
const OVERSCAN = 6
const MAX_RAIL_MARKS = 80

interface ConversationOutlineProps {
  readonly entries: readonly ConversationOutlineEntry[]
  readonly activeSeq: number | null
  readonly jumpingSeq: number | null
  readonly loading: boolean
  readonly error: boolean
  readonly navigationError: boolean
  readonly expanded: boolean
  readonly onExpandedChange: (expanded: boolean) => void
  readonly onJump: (entry: ConversationOutlineEntry) => void
  readonly t: ChatViewSlotProps['t']
}

function sampledRailEntries(entries: readonly ConversationOutlineEntry[]): readonly ConversationOutlineEntry[] {
  if (entries.length <= MAX_RAIL_MARKS) return entries
  const sampled: ConversationOutlineEntry[] = []
  for (let index = 0; index < MAX_RAIL_MARKS; index += 1) {
    const sourceIndex = Math.round(index * (entries.length - 1) / (MAX_RAIL_MARKS - 1))
    const entry = entries[sourceIndex]
    if (entry !== undefined) sampled.push(entry)
  }
  return sampled
}

/**
 * A bounded-DOM, right-edge navigation rail over the complete session history.
 * @param props - directory state and navigation callbacks owned by ChatView.
 * @returns the collapsed rail, expanded virtual panel, or restore control.
 */
export function ConversationOutline({
  entries, activeSeq, jumpingSeq, loading, error, navigationError, expanded, onExpandedChange, onJump, t,
}: ConversationOutlineProps) {
  const [hidden, setHidden] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const activeIndex = entries.findIndex(entry => entry.seq === activeSeq)
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(entries.length, Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN)
  const visible = entries.slice(start, end)
  const railEntries = useMemo(() => sampledRailEntries(entries), [entries])

  useEffect(() => {
    if (!expanded || activeIndex < 0) return
    const viewport = viewportRef.current
    if (viewport === null) return
    const top = activeIndex * ROW_HEIGHT
    const bottom = top + ROW_HEIGHT
    if (top < viewport.scrollTop) viewport.scrollTop = top
    else if (bottom > viewport.scrollTop + VIEWPORT_HEIGHT) {
      viewport.scrollTop = bottom - VIEWPORT_HEIGHT
    }
  }, [activeIndex, expanded])

  if (hidden) {
    return (
      <button
        type="button"
        className={css.restore}
        aria-label={t('outline.show')}
        onClick={() => { setHidden(false) }}
      >
        <IconListPenOutline16 />
      </button>
    )
  }

  return (
    <aside
      className={`${css.shell} ${expanded ? css.expanded : css.collapsed}`}
      aria-label={t('outline.title')}
      onMouseEnter={() => { onExpandedChange(true) }}
    >
      {!expanded && (
        <div className={css.rail}>
          <button
            type="button"
            className={css.railTrigger}
            aria-label={t('outline.open')}
            onClick={() => { onExpandedChange(true) }}
          >
            <IconListPenOutline16 />
          </button>
          <div className={css.railMarks} aria-hidden>
            {railEntries.map((entry, index) => (
              <span
                key={entry.seq}
                className={`${css.railMark} ${css[entry.role]} ${entry.seq === activeSeq ? css.activeMark : ''}`}
                style={{ top: `${railEntries.length <= 1 ? 0 : index * 100 / (railEntries.length - 1)}%` }}
              />
            ))}
          </div>
        </div>
      )}
      {expanded && (
        <div className={css.panel}>
          <header className={css.header}>
            <span className={css.title}><IconListPenOutline16 />{t('outline.title')}</span>
            <span className={css.count}>{t('outline.count', { count: entries.length })}</span>
            <button
              type="button"
              className={css.iconButton}
              aria-label={t('outline.collapse')}
              onClick={() => { onExpandedChange(false) }}
            >
              <IconChevronRightOutline14 />
            </button>
            <button
              type="button"
              className={css.iconButton}
              aria-label={t('outline.hide')}
              onClick={() => {
                onExpandedChange(false)
                setHidden(true)
              }}
            >
              <IconCloseOutline16 />
            </button>
          </header>
          {loading && entries.length === 0 && <div className={css.state}>{t('outline.loading')}</div>}
          {error && entries.length === 0 && <div className={css.error}>{t('outline.error')}</div>}
          {!loading && !error && entries.length === 0 && (
            <div className={css.state}>{t('outline.empty')}</div>
          )}
          {entries.length > 0 && (
            <div
              ref={viewportRef}
              className={css.viewport}
              data-conversation-outline-viewport=""
              onScroll={(event) => { setScrollTop(event.currentTarget.scrollTop) }}
            >
              <div className={css.virtualBody} style={{ height: `${entries.length * ROW_HEIGHT}px` }}>
                <div className={css.virtualWindow} style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
                  {visible.map(entry => (
                    <button
                      key={entry.seq}
                      type="button"
                      className={`${css.row} ${entry.seq === activeSeq ? css.activeRow : ''}`}
                      aria-current={entry.seq === activeSeq ? 'location' : undefined}
                      disabled={jumpingSeq !== null}
                      onClick={() => { onJump(entry) }}
                    >
                      <span className={`${css.roleDot} ${css[entry.role]}`} aria-hidden />
                      <span className={css.role}>{t(`outline.role.${entry.role}`)}</span>
                      <span className={css.summary} title={entry.summary || undefined}>
                        {entry.summary || t(`outline.fallback.${entry.role}`)}
                      </span>
                      {jumpingSeq === entry.seq && <span className={css.jumping}>{t('outline.locating')}</span>}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {(loading || error || navigationError) && entries.length > 0 && (
            <footer className={error || navigationError ? css.footerError : css.footer}>
              {navigationError
                ? t('outline.targetUnavailable')
                : error ? t('outline.partial') : t('outline.refreshing')}
            </footer>
          )}
        </div>
      )}
    </aside>
  )
}
