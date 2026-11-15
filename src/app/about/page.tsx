// DRAFT: factual description of the product; contact details are placeholders in src/lib/legal.ts.
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/page-metadata";
import { ContactLink, LegalPage } from "@/components/legal-page";
import { legalConfig } from "@/lib/legal";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "About",
  description: `What ${siteConfig.name} is and how its listings are sourced.`,
  path: "/about",
});

export default function AboutPage() {
  return (
    <LegalPage title={`About ${siteConfig.name}`}>
      <p>
        {siteConfig.name} is a job board for engineers who build AI agents: orchestration, tool-use backends, local
        LLM infrastructure, evals and related roles.
      </p>

      <h2>Where listings come from</h2>
      <ul>
        <li>Employers post roles directly and pay for a listing.</li>
        <li>
          We also collect roles from the public applicant-tracking boards of listed companies, and keep only those
          that look relevant to agent engineering.
        </li>
      </ul>
      <p>
        Aggregated listings belong to the originating employer. Applications are handled on the employer&apos;s own
        site.
      </p>

      <h2>Contact and removal requests</h2>
      <p>
        Questions, corrections, or want a listing removed? Email <ContactLink email={legalConfig.contactEmail} /> and
        include the listing URL.
      </p>
      <p>
        Employers can <a href="/post-a-job">post a job</a>. See also our <a href="/terms">terms</a>,{" "}
        <a href="/privacy">privacy policy</a> and <a href="/refund">refund policy</a>.
      </p>
    </LegalPage>
  );
}
