/**
 * Reusable placeholder page for modules not yet implemented.
 * Shows the module name, client context, and a "Coming soon" message.
 */
export function PlaceholderPage({
  title,
  clientId,
  description,
}: {
  title: string;
  clientId?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center p-6 py-24">
      <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white px-12 py-10 text-center">
        <h2 className="text-2xl font-bold text-[var(--foreground)]">{title}</h2>
        {clientId && (
          <p className="mt-2 text-sm text-[var(--muted)]">
            Client: <span className="font-medium">{clientId}</span>
          </p>
        )}
        <p className="mt-4 text-[var(--accent-gold)] font-medium">
          Coming soon
        </p>
        {description && (
          <p className="mt-2 max-w-md text-sm text-[var(--muted)]">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
