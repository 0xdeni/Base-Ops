/**
 * The Pools controls row (docs/design/visual-v3.md §6.2, §5.3, §5.4, PH4, TB7).
 *
 * Desktop: the 320 px search, 16 px on the DEX segmented control, the "All pools / Rated only"
 * one, then a spacer and the quiet "Columns" button flush with the right content edge (the shared
 * pools table's ColumnsMenu).
 * Phones: the full-width 44 px search, then two equal buttons that state their value, "All DEXes"
 * and "Sort: health" with its direction arrow, each opening a bottom sheet; the filter sheet has
 * the DEX and the rating, the Sort sheet is the shared one, which is also the column picker.
 */
import type { Dex } from '@depthwatch/core'
import { type MouseEvent, useEffect, useRef, useState } from 'react'
import type { SortDir } from '../../api/types.js'
import { Button } from '../../components/ui/Button.js'
import { SearchInput } from '../../components/ui/Inputs.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { Sheet, SheetOptions } from '../../components/ui/Sheet.js'
import { ColumnsMenu, SortSheet } from '../../components/ui/TableControls.js'
import { isKeyboardClick } from '../../lib/motion.js'
import type { OptionalColumn, PoolsSortKey } from '../../lib/poolsTable.js'

type DexValue = Dex | 'all'
type RatingValue = 'all' | 'rated'

/** Which pools the table offers: every pool (the unrated ones behind a row) or only the rated. */
export const RATING_OPTIONS: ReadonlyArray<{ value: RatingValue; label: string }> = [
  { value: 'all', label: 'All pools' },
  { value: 'rated', label: 'Rated only' },
]

/** The DEX filter's items: "All" first, then every DEX by its full name. */
export const DEX_OPTIONS: ReadonlyArray<{ value: DexValue; label: string; short: string }> = [
  { value: 'all', label: 'All', short: 'All DEXes' },
  { value: 'uniswap-v3', label: 'Uniswap v3', short: 'Uniswap v3' },
  { value: 'uniswap-v4', label: 'Uniswap v4', short: 'Uniswap v4' },
  { value: 'aerodrome-v2', label: 'Aerodrome v2', short: 'Aerodrome v2' },
  { value: 'aerodrome-slipstream', label: 'Aerodrome Slipstream', short: 'Slipstream' },
]

/** How the change was made: keyboard changes never animate (M2). */
export interface ChangeMeta {
  keyboard: boolean
}

export interface PoolsControlsProps {
  phone: boolean
  search: string
  onSearch: (value: string) => void
  dex: Dex | ''
  onDex: (dex: Dex | '', meta: ChangeMeta) => void
  sort: PoolsSortKey
  dir: SortDir
  /** A new sort metric from the phone sheet, at its default direction. */
  onSortKey: (key: PoolsSortKey) => void
  onDir: (dir: SortDir) => void
  cols: readonly OptionalColumn[]
  onCols: (cols: OptionalColumn[]) => void
  /** "Rated only": the pools with no grade are not offered. */
  ratedOnly: boolean
  onRatedOnly: (ratedOnly: boolean, meta: ChangeMeta) => void
}

export function PoolsControls(props: PoolsControlsProps) {
  const { phone, search, onSearch } = props
  return (
    <div className="lists-controls">
      <SearchInput value={search} onChange={onSearch} />
      {phone ? <PhoneControls {...props} /> : <DesktopControls {...props} />}
    </div>
  )
}

function DesktopControls({ dex, onDex, cols, onCols, ratedOnly, onRatedOnly }: PoolsControlsProps) {
  return (
    <>
      <SegmentedControl<DexValue>
        label="DEX"
        options={DEX_OPTIONS}
        value={dex || 'all'}
        onChange={(v, meta) => onDex(v === 'all' ? '' : v, meta)}
      />
      <SegmentedControl<RatingValue>
        label="Rating"
        options={RATING_OPTIONS}
        value={ratedOnly ? 'rated' : 'all'}
        onChange={(v, meta) => onRatedOnly(v === 'rated', meta)}
      />
      <span className="lists-spacer" />
      <ColumnsMenu cols={cols} onChange={onCols} className="lists-cols" />
    </>
  )
}

/** Open state of one phone sheet, and whether it moves (keyboard opens and closes are instant). */
function useSheet() {
  const [open, setOpen] = useState(false)
  const [instant, setInstant] = useState(false)
  return {
    open,
    instant,
    show: (e: MouseEvent) => {
      setInstant(isKeyboardClick(e))
      setOpen(true)
    },
    close: (keyboard = false) => {
      if (keyboard) setInstant(true)
      setOpen(false)
    },
  }
}

function PhoneControls({
  dex,
  onDex,
  sort,
  dir,
  onSortKey,
  onDir,
  ratedOnly,
  onRatedOnly,
}: PoolsControlsProps) {
  const filter = useSheet()
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  const dexLabel = DEX_OPTIONS.find((o) => o.value === (dex || 'all'))?.short ?? 'All DEXes'
  return (
    <div className="lists-ph-ctl">
      <Button
        icon="sliders"
        aria-haspopup="dialog"
        aria-expanded={filter.open}
        onClick={filter.show}
      >
        {dexLabel}
      </Button>
      <SortSheet sort={sort} dir={dir} onSort={onSortKey} onDir={onDir} />
      <Sheet
        open={filter.open}
        instant={filter.instant}
        onClose={() => filter.close()}
        title="Filter pools"
      >
        {/* A tap picks the DEX and closes the sheet after the check lands (160 ms); Enter or
            Space closes it at once; arrow keys only move the selection. */}
        <div
          onClickCapture={(e) => {
            if (!(e.target as Element).closest('.opt')) return
            clearTimeout(closeTimer.current)
            if (isKeyboardClick(e)) filter.close(true)
            else closeTimer.current = setTimeout(() => filter.close(), 160)
          }}
        >
          <SheetOptions<DexValue>
            label="DEX"
            options={DEX_OPTIONS.map((o) => ({
              value: o.value,
              label: o.value === 'all' ? 'All DEXes' : o.label,
            }))}
            value={dex || 'all'}
            onChange={(v) => onDex(v === 'all' ? '' : v, { keyboard: true })}
          />
          <SheetOptions<RatingValue>
            label="Rating"
            options={RATING_OPTIONS}
            value={ratedOnly ? 'rated' : 'all'}
            onChange={(v) => onRatedOnly(v === 'rated', { keyboard: true })}
          />
        </div>
      </Sheet>
    </div>
  )
}
