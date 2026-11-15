import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { confirmTokenSchema } from "@/lib/digest/confirm";
import { ConfirmForm } from "./confirm-form";

export const metadata: Metadata = {
  title: "Confirm your subscription",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ token: string }> };

/**
 * Opening the link never confirms by itself: mail security scanners pre-fetch
 * links, which would otherwise confirm addresses nobody clicked. The change
 * requires an explicit POST (same pattern as the unsubscribe page).
 */
export default async function ConfirmPage({ params }: Props) {
  const { token } = await params;
  if (!confirmTokenSchema.safeParse(token).success) notFound();

  return (
    <div className="mx-auto max-w-lg px-4 py-24 sm:px-6">
      <ConfirmForm token={token} />
    </div>
  );
}
