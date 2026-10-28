/**
 * The pools table's controls (docs/design/visual-v4.md §5.8, §6.3), shared by Pools and Token.
 * Desktop: the small ghost "Columns" button (white on the band) whose popover holds the optional
 * columns' checkboxes (`cols`). Phones: "Sort: health" with the direction arrow opens the Sort
 * sheet, which is also the column picker, because the row's value is always the sort metric; its
 * foot holds the Highest first / Lowest first control. A keyboard open is instant.
 */
import { useState } from 'react'
import type { SortDir } from '../../api/types.js'
import { isKeyboardClick } from '../../lib/motion.js'
import {
  OPTIONAL_COLUMNS,
  type OptionalColumn,
  type PoolsSortKey,
  SORT_KEYS,
  SORT_LABEL,
  SORT_SHORT,
} from '../../lib/poolsTable.js'
import { Button, buttonClass } from './Button.js'
import { Icon } from './Icon.js'
import { Checkbox } from './Inputs.js'
import { Popover } from './Popover.js'
import { SegmentedControl } from './SegmentedControl.js'
import { Sheet, SheetOptions } from './Sheet.js'

export function ColumnsMenu({
  cols,
  onChange,
  className,
}: {
  cols: readonly OptionalColumn[]
  onChange: (cols: OptionalColumn[]) => void
  /** Extra classes of the trigger, for its optical offset in its row. */
  className?: string
}) {
  return (
    <Popover
      label="Columns"
      triggerClassName={buttonClass('ghost', 'sm', className)}
      trigger={
        <>
          <Icon name="columns" />
          Columns
        </>
      }
    >
      <div className="cols-list">
        {OPTIONAL_COLUMNS.map((c) => (
          <Checkbox
            key={c.key}
            checked={cols.includes(c.key)}
            onChange={(on) => onChange(on ? [...cols, c.key] : cols.filter((k) => k !== c.key))}
          >
            {c.label}
          </Checkbox>
        ))}
      </div>
    </Popover>
  )
}

export function SortSheet({
  sort,
  dir,
  onSort,
  onDir,
}: {
  sort: PoolsSortKey
  dir: SortDir
  /** A new sort metric, at its default direction. */
  onSort: (key: PoolsSortKey) => void
  onDir: (dir: SortDir) => void
}) {
  const [open, setOpen] = useState(false)
  const [instant, setInstant] = useState(false)
  return (
    <>
      <Button
        icon={dir === 'asc' ? 'arrowUp' : 'arrowDown'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => {
          setInstant(isKeyboardClick(e))
          setOpen(true)
        }}
      >
        Sort: {SORT_SHORT[sort]}
      </Button>
      <Sheet
        open={open}
        instant={instant}
        onClose={() => setOpen(false)}
        title="Sort pools"
        foot={
          <SegmentedControl<SortDir>
            label="Order"
            full
            options={[
              { value: 'desc', label: 'Highest first' },
              { value: 'asc', label: 'Lowest first' },
            ]}
            value={dir}
            onChange={(d) => onDir(d)}
          />
        }
      >
        <SheetOptions<PoolsSortKey>
          label="Sort by"
          options={SORT_KEYS.map((k) => ({ value: k, label: SORT_LABEL[k] }))}
          value={sort}
          onChange={onSort}
        />
      </Sheet>
    </>
  )
}
