// DRAFT, NOT LEGAL ADVICE. Factual description derived from the code; every
// legal specific is a [[PLACEHOLDER]] in src/lib/legal.ts. Needs lawyer review.
import type { Metadata } from "next";
import { LegalPage, LegalValue } from "@/components/legal-page";
import { legalConfig } from "@/lib/legal";
import { PRICING, formatUsd } from "@/lib/posting/pricing";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of service",
  description: `The terms for using ${siteConfig.domain} and posting jobs on it.`,
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <p>
        These terms govern your use of {siteConfig.domain} (the &ldquo;Service&rdquo;), operated by{" "}
        <LegalValue value={legalConfig.companyName} />. By using the Service or posting a job you agree to them.
      </p>

      <h2>The Service</h2>
      <p>
        {siteConfig.name} is a job board for engineers who build AI agents. It shows listings posted directly by
        employers and listings collected from public job boards of companies. Aggregated listings belong to the
        originating employer; applications are made on the employer&apos;s own site and we are not a party to any
        hiring decision.
      </p>

      <h2>Employer listings and payment</h2>
      <ul>
        <li>
          A listing costs {formatUsd(PRICING.listing.amount)} and stays live for {PRICING.listing.durationDays} days.
          Featured placement is an optional {formatUsd(PRICING.featured.amount)} add-on.
        </li>
        <li>Payment is processed by Stripe. A listing goes live once payment is confirmed.</li>
        <li>If checkout is cancelled or payment fails, you are not charged and the listing is not published.</li>
        <li>When the listing period ends, the listing is no longer shown.</li>
        <li>
          Refunds are described in the <a href="/refund">refund policy</a>.
        </li>
      </ul>

      <h2>Your content</h2>
      <p>
        You are responsible for the accuracy and lawfulness of anything you submit and confirm you have the right to
        publish it. Listings must describe a real role and must not be misleading or discriminatory. We may remove any
        listing that breaks these terms.
      </p>

      <h2>Removal requests</h2>
      <p>
        If you are an employer and want an aggregated listing corrected or removed, contact us using the details on the{" "}
        <a href="/about">about page</a> and we will review the request.
      </p>

      <h2>Disclaimers and liability</h2>
      <p>[[PLACEHOLDER: warranty disclaimer and limitation of liability, to be written or approved by a lawyer]]</p>

      <h2>Governing law</h2>
      <p>
        <LegalValue value={legalConfig.jurisdiction} />
      </p>

      <h2>Changes</h2>
      <p>We may update these terms. The date at the top of this page shows when they last changed.</p>
    </LegalPage>
  );
}
