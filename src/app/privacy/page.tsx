// Draft for counsel review, not legal advice. Factual description derived from the
// code; remaining legal specifics are [[PLACEHOLDER]]s in src/lib/legal.ts.
// Retention periods mirror run_maintenance() in
// supabase/migrations/20261116000400_data_retention.sql: change both together.
import type { Metadata } from "next";
import { ContactLink, LegalPage, LegalValue } from "@/components/legal-page";
import { legalConfig } from "@/lib/legal";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: `What ${siteConfig.domain} collects, who processes it, and how to ask for deletion.`,
  alternates: { canonical: "/privacy" },
};

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
        <li>Company name, contact email, and the optional website and logo you submit.</li>
        <li>The listing text you submit.</li>
        <li>
          Your Stripe customer id and checkout session id. Card details go to Stripe and are never stored by us.
        </li>
      </ul>
      <h3>Email subscribers</h3>
      <ul>
        <li>Your email address and where you signed up.</li>
        <li>A record of which weekly digests were sent to you.</li>
        <li>Every email carries a one-click unsubscribe link (RFC 8058) and a postal address.</li>
      </ul>
      <h3>Visitors</h3>
      <ul>
        <li>We do not use advertising cookies or ad trackers.</li>
        <li>
          To limit abuse, we rate-limit form submissions and some requests by a hash of your IP address. We store
          only the hash, not the address, and each entry is deleted after about a day. Our hosting provider also
          handles IP addresses in its ordinary server logs.
        </li>
      </ul>

      <h2>Who processes data for us</h2>
      <ul>
        <li>Stripe: payments.</li>
        <li>Resend: sending email.</li>
        <li>Supabase: database hosting.</li>
        <li>Vercel: website hosting.</li>
        <li>GitHub Actions: scheduled collection of public job listings.</li>
      </ul>

      <h2>Retention</h2>
      <ul>
        <li>
          Email subscribers: kept until you unsubscribe. Your address is then deleted 90 days after you
          unsubscribed.
        </li>
        <li>Records of which digests were sent to you: deleted after 12 months.</li>
        <li>
          Employer records and listings: kept while the listing is live. Expired, rejected and unpaid listings, and
          employer contact details with no remaining listings, are deleted 24 months after the listing ended or the
          account was created. Stripe keeps its own payment records under its own policies.
        </li>
        <li>Unpaid draft listings that never reached checkout: deleted after 48 hours.</li>
        <li>Hashed rate-limit entries: about 1 day. Ingestion run logs: 90 days.</li>
      </ul>

      <h2>Your rights and deletion</h2>
      <p>
        To access, correct or erase your data, or to unsubscribe from everything, email{" "}
        <ContactLink email={legalConfig.privacyEmail} /> from the address concerned (or tell us which address and
        listing it relates to). We may need to confirm you control that address before acting. You can also
        unsubscribe with the link in any email.
      </p>

      <h2>Listings collected from other sites</h2>
      <p>
        Some listings are collected from the public job boards of the hiring companies and shown here with the
        company name, the original text and a link to the original posting, which is where you apply. They belong to
        the originating employer. To ask for a listing or a company to be removed, email{" "}
        <ContactLink email={legalConfig.contactEmail} /> with the listing URL. We act on removal requests within{" "}
        {legalConfig.takedownResponse}, and a company that asks to be removed is not collected again.
      </p>

      <h2>Legal basis and transfers</h2>
      <p>[[PLACEHOLDER: legal bases and international transfer wording, per jurisdiction, from a lawyer]]</p>
    </LegalPage>
  );
}
