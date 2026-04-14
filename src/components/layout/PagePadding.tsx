/**
 * Standard page padding wrapper.
 *
 * After removing p-6 from <main> in the dashboard layout (to allow sticky
 * sub-headers to sit flush with the header), each page that doesn't have
 * its own full-bleed layout should wrap its content in <PagePadding>.
 */
export function PagePadding({ children }: { children: React.ReactNode }) {
  return <div className="p-6">{children}</div>;
}
