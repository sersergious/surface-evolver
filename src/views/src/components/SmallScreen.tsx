export default function SmallScreen() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-base-100 px-6">
      <div className="card bg-base-200 shadow-xl max-w-sm w-full">
        <div className="card-body items-center text-center gap-3">
          <h2 className="card-title text-base-content">Surface Evolver</h2>
          <p className="text-sm text-base-content/60">
            This application requires a larger screen. Please resize your window or use a desktop display.
          </p>
        </div>
      </div>
    </div>
  )
}
