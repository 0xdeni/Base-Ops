/**
 * The v4 charts (docs/design/visual-v4.md §5.9, §7.5): hand-written SVG and HTML, themed by the
 * CSS tokens only, each with a `role="img"` (or `group`) summary and a "Show data" table where the
 * spec asks for one (CH9). The band charts carry the first view's attributes (`data-chart`,
 * `data-bar`, `data-furniture`, `data-sq`, `data-area`, `data-pt`; see lib/firstView.ts).
 */
export { BulletGraph, bulletFractions, depthBullet } from './BulletGraph.js'
export { pickButterflyRows } from './butterflyModel.js'
export { ButterflyTable, DepthCurveTable, MarketMakerTable } from './ChartTables.js'
export { ChartTooltip, placeChartTip } from './ChartTooltip.js'
export { type ButterflyGap, DepthButterfly } from './DepthButterfly.js'
export { DepthCurve } from './DepthCurve.js'
export { HealthBar, weakestPart } from './HealthBar.js'
export { KpiChart } from './KpiChart.js'
export { kpiModel } from './kpiModel.js'
export { MarketMakerChart } from './MarketMakerChart.js'
export { RowDepthGlyph } from './RowDepthGlyph.js'
export { ShareBar } from './ShareBar.js'
export { ShowData } from './ShowData.js'
export { type MultipleSeries, SmallMultiples } from './SmallMultiples.js'
export { SpreadLollipop } from './SpreadLollipop.js'
export { SquareField } from './SquareField.js'
export { squareField } from './squareFieldModel.js'
export { MEANINGFUL_GAP_SCORE, MEANINGFUL_GAP_TURNOVER, TurnoverGlyph } from './TurnoverGlyph.js'
export { UptimeStrip } from './UptimeStrip.js'
