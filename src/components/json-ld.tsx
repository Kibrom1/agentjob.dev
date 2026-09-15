type JsonLdProps = {
  data: Record<string, unknown>;
};

/**
 * Structured data block. `<` is escaped so user-controlled strings can never
 * close the script element.
 */
export function JsonLd({ data }: JsonLdProps) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
