import { SubscribeForm } from "@/components/subscribe-form";

type SubscribeCardProps = {
  source: "website" | "job-page";
  idPrefix: string;
};

export function SubscribeCard({ source, idPrefix }: SubscribeCardProps) {
  return (
    <section
      id="subscribe"
      aria-labelledby={`${idPrefix}-heading`}
      className="scroll-mt-20 rounded-xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900/60"
    >
      <p className="font-mono text-xs tracking-wider text-accent-700 uppercase dark:text-accent-400">Weekly digest</p>
      <h2 id={`${idPrefix}-heading`} className="mt-1 text-base font-semibold tracking-tight">
        Get AI agent jobs straight to your inbox
      </h2>
      <p className="mt-1 mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        One email a week with the newest roles. No spam, unsubscribe anytime.
      </p>
      <SubscribeForm source={source} idPrefix={idPrefix} />
    </section>
  );
}
