// Small pieces of arithmetic for the bar chart, kept apart from the drawing so they can be tested.

/**
 * The top of the chart's vertical axis: a round number at or above the biggest bar.
 * A tallest bar of 7 gives an axis up to 8, and of 13 gives 20, so the gridlines
 * fall on numbers people can read at a glance.
 */
export function niceMax(max: number): number {
  if (max <= 4) return 4; // never a tiny axis: one booking shouldn't fill the whole chart
  if (max <= 8) return 8;
  const step = 10 ** Math.max(1, String(Math.ceil(max)).length - 1);
  return Math.ceil(max / step) * step;
}

/** Label every n-th day along the bottom, so about seven labels show however long the range. */
export function labelStride(days: number): number {
  return Math.max(1, Math.ceil(days / 7));
}

/** "42.5%" for 0.425, "9%" for 0.09, "0%" for 0. */
export function formatPercent(rate: number): string {
  return new Intl.NumberFormat("en-IN", { style: "percent", maximumFractionDigits: 1 }).format(rate);
}
