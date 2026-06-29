<script lang="ts">
  import {
    ReaderStatisticsTracker,
    type ReaderStatisticsClock,
    type ReadingStatistic,
  } from "./reading-statistics";

  let now = 1_778_623_200_000;
  let dateKey = "2026-05-13";
  const clock: ReaderStatisticsClock = {
    nowMillis: () => now,
    currentDateKey: () => dateKey,
  };
  const initial: ReadingStatistic[] = [
    {
      title: "Book",
      dateKey: "2026-05-12",
      charactersRead: 100,
      readingTime: 50,
      minReadingSpeed: 7200,
      altMinReadingSpeed: 7200,
      lastReadingSpeed: 7200,
      maxReadingSpeed: 7200,
      lastStatisticModified: 100,
    },
  ];
  const tracker = new ReaderStatisticsTracker("Book", initial, true, clock);

  tracker.start(100);
  now += 10_000;
  tracker.update(130);
  dateKey = "2026-05-14";
  now += 10_000;
  tracker.update(90);
  now += 10_000;
  tracker.update(10);
  tracker.pause(10);
  const persisted = tracker.statisticsForPersistence();
</script>

<div
  class="probe-state"
  data-tracking={tracker.state.isTracking}
  data-session-chars={tracker.state.session.charactersRead}
  data-session-time={tracker.state.session.readingTime}
  data-session-speed={tracker.state.session.lastReadingSpeed}
  data-today-key={tracker.state.today.dateKey}
  data-today-chars={tracker.state.today.charactersRead}
  data-all-time-chars={tracker.state.allTime.charactersRead}
  data-persisted={JSON.stringify(persisted)}
></div>
