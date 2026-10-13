import { notFound } from 'next/navigation';
import ResultsViewerFixture from './ResultsViewerFixture';

// Local-development only: a fixture page for the live results viewer's
// layout (and, with ?celebrate=<variant>, the record-break card). In a production
// build (Vercel production AND preview) this route is a 404.
//
// The query string is read HERE, on the server, and handed down as a prop —
// reading it inside the client component would render one thing on the
// server and another in the browser.
export default async function ResultsViewerTestPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const params = await searchParams;
  const mode = 'celebrate' in params ? 'celebrate' : 'embedded' in params ? 'embedded' : 'overlay';
  const variant = typeof params.celebrate === 'string' ? params.celebrate : '';
  return <ResultsViewerFixture mode={mode} celebrate={variant} />;
}
