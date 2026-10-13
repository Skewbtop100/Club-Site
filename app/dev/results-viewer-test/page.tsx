import { notFound } from 'next/navigation';
import ResultsViewerFixture from './ResultsViewerFixture';

// Local-development only: a fixture page for the live results viewer's
// layout. In a production build (Vercel production AND preview) this route
// is a 404 — it is prerendered at build time, when NODE_ENV is already
// 'production', so the fixture is never served there.
export default function ResultsViewerTestPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <ResultsViewerFixture />;
}
