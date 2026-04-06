'use client';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-8">
      <h1 className="text-xl font-bold text-red-600 mb-4">Dashboard Error</h1>
      <pre className="bg-red-50 border border-red-200 rounded p-4 text-sm text-red-800 whitespace-pre-wrap mb-4">
        {error.message}
        {error.stack && '\n\n' + error.stack}
      </pre>
      <p className="text-sm text-gray-500 mb-4">Digest: {error.digest || 'none'}</p>
      <button onClick={reset} className="px-4 py-2 bg-red-600 text-white rounded">
        Try Again
      </button>
    </div>
  );
}
