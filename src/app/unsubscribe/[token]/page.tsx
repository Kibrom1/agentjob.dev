import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { tokenSchema } from "@/lib/unsubscribe";
import { UnsubscribeForm } from "./unsubscribe-form";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ token: string }> };

/**
 * Opening the link never unsubscribes by itself: mail security scanners
 * pre-fetch links, so the change requires an explicit POST.
 */
export default async function UnsubscribePage({ params }: Props) {
  const { token } = await params;
  if (!tokenSchema.safeParse(token).success) notFound();

  return (
    <div className="mx-auto max-w-lg px-4 py-24 sm:px-6">
      <UnsubscribeForm token={token} />
    </div>
  );
}
