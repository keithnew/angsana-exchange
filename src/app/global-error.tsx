'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ padding: '2rem', fontFamily: 'monospace' }}>
        <h1 style={{ color: 'red' }}>Global Error</h1>
        <pre style={{ background: '#fff0f0', padding: '1rem', borderRadius: '4px', whiteSpace: 'pre-wrap' }}>
          {error.message}
          {error.stack && '\n\n' + error.stack}
        </pre>
        <p>Digest: {error.digest || 'none'}</p>
        <button onClick={reset} style={{ padding: '8px 16px', background: 'red', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          Try Again
        </button>
      </body>
    </html>
  );
}
