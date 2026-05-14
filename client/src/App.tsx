function App() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8">
      <div className="space-y-6 text-center max-w-2xl">
        <div className="badge-atlas mx-auto w-fit py-1.5">
          <div className="w-1 h-1 rounded-full bg-accent" />
          Ready for Task Challenge
        </div>
        
        <h1 className="hero-title text-text">
          Aragon <span className="text-gradient">AI</span>
        </h1>
        
        <p className="body-text text-xl text-text-dim/80">
          Scaffold cleaned and ready. The design system, database connections, and server configuration are preserved for the upcoming task.
        </p>

        <div className="pt-8">
          <div className="card-atlas p-8 text-left">
            <h3 className="text-lg font-semibold mb-2">Workspace Status</h3>
            <ul className="space-y-2 text-sm text-text-dim">
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Vite + React Client (Tailwind v4)
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Express + Prisma Server
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Atlas Design System
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
