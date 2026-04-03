interface RunResultOverlayProps {
  body: string
  eyebrow: string
  isFinished: boolean
  onFlyAgain: () => void
  onReturnToAutopilot: () => void
  title: string
}

export function RunResultOverlay({
  body,
  eyebrow,
  isFinished,
  onFlyAgain,
  onReturnToAutopilot,
  title,
}: RunResultOverlayProps) {
  return (
    <div className="run-result-shell">
      <div
        className={`run-result ${isFinished ? 'is-finished' : 'is-crashed'}`}
      >
        <p className="run-result-label">{eyebrow}</p>
        <h2>{title}</h2>
        <p className="run-result-body">{body}</p>
        <div className="run-result-actions">
          <button className="control-button accent" onClick={onFlyAgain}>
            Fly again
          </button>
          <button className="control-button" onClick={onReturnToAutopilot}>
            Return to autopilot
          </button>
        </div>
      </div>
    </div>
  )
}
