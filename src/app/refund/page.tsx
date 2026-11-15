// DRAFT, NOT LEGAL ADVICE. The refund terms are an undecided business and legal
// choice: every commitment below is a [[PLACEHOLDER]] until the owner decides.
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/page-metadata";
import { ContactLink, LegalPage } from "@/components/legal-page";
import { legalConfig } from "@/lib/legal";
import { PRICING, formatUsd } from "@/lib/posting/pricing";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Refund policy",
  description: `Refunds for job listings on ${siteConfig.domain}.`,
  path: "/refund",
});

export default function RefundPage() {
  return (
    <LegalPage title="Refund policy">
      <p>
        A listing costs {formatUsd(PRICING.listing.amount)} for {PRICING.listing.durationDays} days, plus{" "}
        {formatUsd(PRICING.featured.amount)} for featured placement. Listings go live as soon as payment is confirmed.
      </p>
      <p>
        If checkout is cancelled or payment fails you are not charged. For any other request, email{" "}
        <ContactLink email={legalConfig.contactEmail} />.
      </p>

      <h2>Refund terms</h2>
      <p>
        [[PLACEHOLDER: refund policy, for example the window and conditions under which a paid listing is refunded.
        Needs an owner decision and legal review before launch]]
      </p>
    </LegalPage>
  );
}
