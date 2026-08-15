export default function LandingLoading() {
  return (
    <main className="landing-route-skeleton min-h-screen" aria-busy="true" aria-label="Loading programmes">
      <style>{`
        .landing-route-skeleton {
          --landing-skeleton-bg: #f4f7f9;
          --landing-skeleton-surface: #ffffff;
          --landing-skeleton-pulse: rgba(0, 0, 0, 0.10);
          --landing-skeleton-border: rgba(0, 0, 0, 0.05);
          background: var(--landing-skeleton-bg);
        }
        html[data-theme='dark'] .landing-route-skeleton {
          --landing-skeleton-bg: #0d1117;
          --landing-skeleton-surface: #121820;
          --landing-skeleton-pulse: rgba(255, 255, 255, 0.10);
          --landing-skeleton-border: rgba(255, 255, 255, 0.07);
        }
        @media (prefers-color-scheme: dark) {
          html:not([data-theme='light']) .landing-route-skeleton {
            --landing-skeleton-bg: #0d1117;
            --landing-skeleton-surface: #121820;
            --landing-skeleton-pulse: rgba(255, 255, 255, 0.10);
            --landing-skeleton-border: rgba(255, 255, 255, 0.07);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .landing-route-skeleton .animate-pulse { animation: none; }
        }
      `}</style>
      <div className="h-16 border-b px-6 md:px-10 flex items-center justify-between"
        style={{ background: 'var(--landing-skeleton-surface)', borderColor: 'var(--landing-skeleton-border)' }}>
        <div className="h-8 w-32 rounded-md animate-pulse" style={{ background: 'var(--landing-skeleton-pulse)' }} />
        <div className="h-8 w-24 rounded-md animate-pulse" style={{ background: 'var(--landing-skeleton-pulse)' }} />
      </div>
      <div className="max-w-[1240px] mx-auto px-6 md:px-10 py-12">
        <div className="h-48 md:h-64 rounded-lg animate-pulse" style={{ background: 'var(--landing-skeleton-pulse)' }} />
        <div className="h-8 w-44 mt-12 rounded animate-pulse" style={{ background: 'var(--landing-skeleton-pulse)' }} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          {[0, 1, 2, 3].map((item) => (
            <div key={item}>
              <div className="w-full aspect-video rounded-lg animate-pulse" style={{ background: 'var(--landing-skeleton-pulse)' }} />
              <div className="h-4 w-4/5 mt-3 rounded animate-pulse" style={{ background: 'var(--landing-skeleton-pulse)' }} />
              <div className="h-3 w-2/5 mt-2 rounded animate-pulse" style={{ background: 'var(--landing-skeleton-pulse)' }} />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
