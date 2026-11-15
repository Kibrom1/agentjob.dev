import { formatLocationSummary, formatSalaryRange } from "@/lib/format";
import { JOB_TYPE_LABELS, WORKPLACE_LABELS, type JobType, type WorkplaceType } from "@/lib/types";

type JobMetaProps = {
  location: string;
  workplaceType: WorkplaceType;
  jobType: JobType;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
};

/**
 * "Remote (US) +2 more · Full-time · $180K – $240K". Multi-location strings are
 * condensed to the first location plus a count (full list in the tooltip). The
 * workplace label is dropped when the location already says it (e.g. "Remote").
 */
export function JobMeta({ location, workplaceType, jobType, salaryMin, salaryMax, salaryCurrency }: JobMetaProps) {
  const workplace = WORKPLACE_LABELS[workplaceType];
  const salary = formatSalaryRange(salaryMin, salaryMax, salaryCurrency);
  const summary = formatLocationSummary(location);
  const locationMentionsWorkplace = summary.full.toLowerCase().includes(workplace.toLowerCase());

  const parts: Array<{ key: string; label: string; emphasis?: boolean; title?: string }> = [
    ...(summary.display
      ? [{ key: "location", label: summary.display, title: summary.extra > 0 ? summary.full : undefined }]
      : []),
    ...(locationMentionsWorkplace ? [] : [{ key: "workplace", label: workplace }]),
    { key: "type", label: JOB_TYPE_LABELS[jobType] },
    // Most ingested roles carry no salary; omitting the label keeps cards quiet. The detail page says "Not listed".
    ...(salary ? [{ key: "salary", label: salary, emphasis: true }] : []),
  ];

  return (
    <ul className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
      {parts.map((part) => (
        <li key={part.key} className="meta-item">
          <span
            title={part.title}
            className={part.emphasis ? "font-medium text-zinc-800 dark:text-zinc-200" : undefined}
          >
            {part.label}
          </span>
        </li>
      ))}
    </ul>
  );
}
