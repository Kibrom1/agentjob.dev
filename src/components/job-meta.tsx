import { formatSalaryRange } from "@/lib/format";
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
 * "Remote (US) · Remote · Full-time · $180K – $240K". The workplace label is
 * dropped when the location string already says it (e.g. "Remote").
 */
export function JobMeta({ location, workplaceType, jobType, salaryMin, salaryMax, salaryCurrency }: JobMetaProps) {
  const workplace = WORKPLACE_LABELS[workplaceType];
  const salary = formatSalaryRange(salaryMin, salaryMax, salaryCurrency);
  const locationMentionsWorkplace = location.toLowerCase().includes(workplace.toLowerCase());

  const parts: Array<{ key: string; label: string; emphasis?: boolean }> = [
    { key: "location", label: location },
    ...(locationMentionsWorkplace ? [] : [{ key: "workplace", label: workplace }]),
    { key: "type", label: JOB_TYPE_LABELS[jobType] },
    ...(salary ? [{ key: "salary", label: salary, emphasis: true }] : []),
  ];

  return (
    <ul className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
      {parts.map((part, index) => (
        <li key={part.key} className="flex items-center gap-2">
          {index > 0 && (
            <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
              ·
            </span>
          )}
          <span className={part.emphasis ? "font-medium text-zinc-800 dark:text-zinc-200" : undefined}>{part.label}</span>
        </li>
      ))}
    </ul>
  );
}
