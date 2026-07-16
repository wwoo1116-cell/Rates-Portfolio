/**
 * Percentile fan-band custom series (s11 T3) — lightweight-charts v5
 * ICustomSeriesPaneView painting two filled bands (5–95 outer, 25–75 inner)
 * behind the percentile lines. Slice-local: the canonical SeriesChart
 * (@/components/charts, Session-A-owned) stays untouched — the panel adds this
 * series through SeriesChart's public onChartReady(chart) seam, which creates
 * it BEFORE SeriesChart's own line series so the fills always render underneath.
 *
 * Colors arrive as resolved hex from chart-theme.ts (no literals here — slice
 * lint block C); translucency is applied at draw time via ctx.globalAlpha so
 * no new tokens are introduced.
 */
import type {
  CustomData,
  CustomSeriesOptions,
  CustomSeriesPricePlotValues,
  ICustomSeriesPaneRenderer,
  ICustomSeriesPaneView,
  PaneRendererCustomData,
  PriceToCoordinateConverter,
  Time,
  WhitespaceData,
} from "lightweight-charts";
import { customSeriesDefaultOptions } from "lightweight-charts";

export interface FanBandData extends CustomData<Time> {
  p5: number;
  p25: number;
  p75: number;
  p95: number;
}

export interface FanBandSeriesOptions extends CustomSeriesOptions {
  outerColor: string;
  innerColor: string;
  outerAlpha: number;
  innerAlpha: number;
  /** s15 T4 — stroke width (CSS px) for the percentile edge lines drawn by
   * this series. The edges used to be four separate SeriesChart line series,
   * each minting a price-scale badge; drawing them here keeps the visual and
   * leaves the last-value badge to the center (base-run) line only. 0 = off. */
  edgeWidth: number;
  edgeAlpha: number;
}

type DrawTarget = Parameters<ICustomSeriesPaneRenderer["draw"]>[0];

class FanBandRenderer implements ICustomSeriesPaneRenderer {
  private _data: PaneRendererCustomData<Time, FanBandData> | null = null;
  private _options: FanBandSeriesOptions | null = null;

  update(data: PaneRendererCustomData<Time, FanBandData>, options: FanBandSeriesOptions): void {
    this._data = data;
    this._options = options;
  }

  draw(target: DrawTarget, priceConverter: PriceToCoordinateConverter): void {
    target.useBitmapCoordinateSpace((scope) => {
      const data = this._data;
      const options = this._options;
      if (!data || !options || data.bars.length === 0 || !data.visibleRange) return;

      const ctx = scope.context;
      const hpr = scope.horizontalPixelRatio;
      const vpr = scope.verticalPixelRatio;
      const { from, to } = data.visibleRange;
      const bars = data.bars.slice(from, to);
      if (bars.length < 2) return;

      const fillBand = (
        lowKey: "p5" | "p25",
        highKey: "p95" | "p75",
        color: string,
        alpha: number,
      ) => {
        ctx.save();
        ctx.beginPath();
        let started = false;
        for (const bar of bars) {
          // Whitespace rows (calendar-gap slots, s15 T4) carry no percentile
          // values — skip them; the polygon spans the gap between real points.
          if (bar.originalData[highKey] === undefined) continue;
          const y = priceConverter(bar.originalData[highKey]);
          if (y == null) continue;
          const px = bar.x * hpr;
          if (!started) {
            ctx.moveTo(px, y * vpr);
            started = true;
          } else {
            ctx.lineTo(px, y * vpr);
          }
        }
        for (let i = bars.length - 1; i >= 0; i--) {
          if (bars[i].originalData[lowKey] === undefined) continue;
          const y = priceConverter(bars[i].originalData[lowKey]);
          if (y == null) continue;
          ctx.lineTo(bars[i].x * hpr, y * vpr);
        }
        ctx.closePath();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
      };

      // Outer first so the inner band reads as a second, denser layer.
      fillBand("p5", "p95", options.outerColor, options.outerAlpha);
      fillBand("p25", "p75", options.innerColor, options.innerAlpha);

      // s15 T4 — percentile edge strokes (see FanBandSeriesOptions.edgeWidth).
      const strokeEdge = (key: "p5" | "p25" | "p75" | "p95", color: string) => {
        ctx.save();
        ctx.beginPath();
        let started = false;
        for (const bar of bars) {
          if (bar.originalData[key] === undefined) continue;
          const y = priceConverter(bar.originalData[key]);
          if (y == null) continue;
          const px = bar.x * hpr;
          if (!started) {
            ctx.moveTo(px, y * vpr);
            started = true;
          } else {
            ctx.lineTo(px, y * vpr);
          }
        }
        ctx.globalAlpha = options.edgeAlpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = options.edgeWidth * vpr;
        ctx.lineJoin = "round";
        ctx.stroke();
        ctx.restore();
      };
      if (options.edgeWidth > 0) {
        strokeEdge("p5", options.outerColor);
        strokeEdge("p95", options.outerColor);
        strokeEdge("p25", options.innerColor);
        strokeEdge("p75", options.innerColor);
      }
    });
  }
}

export class FanBandSeries implements ICustomSeriesPaneView<Time, FanBandData, FanBandSeriesOptions> {
  private _renderer = new FanBandRenderer();

  priceValueBuilder(row: FanBandData): CustomSeriesPricePlotValues {
    // min/max feed autoscale so the fan is never clipped; the last entry is the
    // series' "current price" (used for crosshair snap on this series only).
    return [row.p5, row.p95, (row.p25 + row.p75) / 2];
  }

  isWhitespace(data: FanBandData | WhitespaceData<Time>): data is WhitespaceData<Time> {
    return (data as Partial<FanBandData>).p5 === undefined;
  }

  renderer(): ICustomSeriesPaneRenderer {
    return this._renderer;
  }

  update(data: PaneRendererCustomData<Time, FanBandData>, options: FanBandSeriesOptions): void {
    this._renderer.update(data, options);
  }

  defaultOptions(): FanBandSeriesOptions {
    return {
      ...customSeriesDefaultOptions,
      // Real colors are always passed by the panel from chart-theme; these
      // defaults only exist to satisfy the interface and are never painted
      // (empty string draws nothing visible at alpha 0).
      outerColor: "",
      innerColor: "",
      outerAlpha: 0,
      innerAlpha: 0,
      edgeWidth: 0,
      edgeAlpha: 1,
    };
  }
}
