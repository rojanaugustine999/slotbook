// ─── Laying out overlapping bookings ─────────────────────────────────────────
// Priya and Arjun can both have a booking at 10:00 on the same day. In a calendar
// column those two blocks would sit on top of each other, so we put them side by side.
//
// The rule, in two steps:
//  1. Group bookings into "clusters": a run of bookings where each overlaps the one
//     before it. A booking that starts after the cluster has ended starts a new cluster.
//  2. Inside a cluster, give each booking the first free "lane" (a vertical slot). If
//     none is free, open a new lane. The cluster is then drawn `lanes` columns wide.
//
// Result for each booking: which lane it is in, and how many lanes its cluster has, so
// its width is 1/lanes of the column and its left edge is lane/lanes.
// ──────────────────────────────────────────────────────────────────────────────

export interface Positioned<T> {
  item: T;
  lane: number; // 0 for the leftmost
  lanes: number; // how many lanes the cluster this booking belongs to has
  startMin: number; // minutes after midnight
  endMin: number;
}

export function layoutDay<T>(items: T[], range: (item: T) => { startMin: number; endMin: number }): Positioned<T>[] {
  const events = items.map((item) => ({ item, ...range(item) })).sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const result: Positioned<T>[] = [];
  let cluster: Positioned<T>[] = [];
  let clusterEnd = -Infinity;
  let laneEnds: number[] = []; // when each lane becomes free again

  const closeCluster = () => {
    for (const placed of cluster) placed.lanes = laneEnds.length;
    result.push(...cluster);
    cluster = [];
    laneEnds = [];
    clusterEnd = -Infinity;
  };

  for (const event of events) {
    // Starting exactly when the cluster ends does NOT overlap (10:00 to 11:00, then 11:00 to 12:00).
    if (event.startMin >= clusterEnd) closeCluster();

    let lane = laneEnds.findIndex((end) => end <= event.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(event.endMin);
    } else {
      laneEnds[lane] = event.endMin;
    }

    cluster.push({ item: event.item, lane, lanes: 1, startMin: event.startMin, endMin: event.endMin });
    clusterEnd = Math.max(clusterEnd, event.endMin);
  }
  closeCluster();

  return result;
}

/**
 * The hours the calendar should show: normally 9 to 18, stretched if a booking falls outside.
 * Returns whole hours: { startHour: 9, endHour: 18 } shows rows for 9, 10, ... 17.
 */
export function calendarHours(ranges: { startMin: number; endMin: number }[], defaultStart = 9, defaultEnd = 18): { startHour: number; endHour: number } {
  let startHour = defaultStart;
  let endHour = defaultEnd;
  for (const { startMin, endMin } of ranges) {
    startHour = Math.min(startHour, Math.floor(startMin / 60));
    endHour = Math.max(endHour, Math.ceil(endMin / 60));
  }
  return { startHour, endHour: Math.min(endHour, 24) };
}
