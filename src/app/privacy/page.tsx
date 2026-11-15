// DRAFT, NOT LEGAL ADVICE. Factual description derived from the code; every
// legal specific is a [[PLACEHOLDER]] in src/lib/legal.ts. Needs lawyer review.
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/page-metadata";
import { ContactLink, LegalPage, LegalValue } from "@/components/legal-page";
import { legalConfig } from "@/lib/legal";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Privacy policy",
  description: `What ${siteConfig.domain} collects, who processes it, and how to ask for deletion.`,
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        This policy explains what {siteConfig.domain} collects. The controller is{" "}
        <LegalValue value={legalConfig.companyName} />
        {legalConfig.postalAddress && (
          <>
            , <LegalValue value={legalConfig.postalAddress} />
          </>
        )}
        .
      </p>

      <h2>What we collect</h2>
      <h3>Employers posting a job</h3>
      <ul>
        <li>Company name and contact email.</li>
        <li>The listing text you submit.</li>
        <li>The Stripe checkout session id. Card details go to Stripe and are never stored by us.</li>
      </ul>
      <h3>Email subscribers</h3>
      <ul>
        <li>Your email address and where you signed up.</li>
        <li>Every email carries a one-click unsubscribe link (RFC 8058) and a postal address.</li>
      </ul>
      <h3>Visitors</h3>
      <p>We do not use advertising cookies or ad trackers.</p>

      <h2>Who processes data for us</h2>
      <ul>
        <li>Stripe: payments.</li>
        <li>Resend: sending email.</li>
        <li>Supabase: database hosting.</li>
        <li>Vercel: website hosting.</li>
        <li>GitHub Actions: scheduled collection of public job listings.</li>
      </ul>

      <h2>Retention</h2>
      <p>[[PLACEHOLDER: retention periods for employer records, subscriber emails and logs]]</p>

      <h2>Your rights and deletion</h2>
      <p>
        To access, correct or delete your data, or to unsubscribe from everything, email{" "}
        <ContactLink email={legalConfig.privacyEmail} />. You can also unsubscribe with the link in any email.
      </p>

      <h2>Listings collected from other sites</h2>
      <p>
        Aggregated listings are published by the originating employers. To ask for removal, email{" "}
        <ContactLink email={legalConfig.contactEmail} />.
      </p>

      <h2>Legal basis and transfers</h2>
      <p>[[PLACEHOLDER: legal bases and international transfer wording, per jurisdiction, from a lawyer]]</p>
    </LegalPage>
  );
}
