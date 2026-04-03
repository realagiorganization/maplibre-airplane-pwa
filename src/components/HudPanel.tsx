export interface StatusChipData {
  label: string
  variant?: 'accent' | 'danger' | 'success' | 'warning'
}

export interface TelemetryCardData {
  label: string
  value: string
}

export interface MissionCardData {
  label: string
  subtitle: string
  title: string
}

interface HudPanelProps {
  cameraActionLabel: string
  missionCards: MissionCardData[]
  onCameraAction: () => void
  onPauseAction: () => void
  onPrimaryAction: () => void
  onResetAction: () => void
  pauseActionLabel: string
  pauseDisabled: boolean
  primaryActionLabel: string
  resetActionLabel: string
  statusChips: StatusChipData[]
  telemetryCards: TelemetryCardData[]
}

export function HudPanel({
  cameraActionLabel,
  missionCards,
  onCameraAction,
  onPauseAction,
  onPrimaryAction,
  onResetAction,
  pauseActionLabel,
  pauseDisabled,
  primaryActionLabel,
  resetActionLabel,
  statusChips,
  telemetryCards,
}: HudPanelProps) {
  return (
    <div className="hud-panel">
      <div className="status-row">
        {statusChips.map((chip) => (
          <span
            key={chip.label}
            className={statusChipClassName(chip.variant)}
          >
            {chip.label}
          </span>
        ))}
      </div>

      <div className="telemetry-grid">
        {telemetryCards.map((card) => (
          <TelemetryCard key={card.label} label={card.label} value={card.value} />
        ))}
      </div>

      <div className="control-row">
        <button className="control-button accent" onClick={onPrimaryAction}>
          {primaryActionLabel}
        </button>
        <button className="control-button" onClick={onCameraAction}>
          {cameraActionLabel}
        </button>
        <button
          className="control-button"
          disabled={pauseDisabled}
          onClick={onPauseAction}
        >
          {pauseActionLabel}
        </button>
        <button className="control-button" onClick={onResetAction}>
          {resetActionLabel}
        </button>
      </div>

      <div className="mission-grid">
        {missionCards.map((card) => (
          <MissionCard
            key={card.label}
            label={card.label}
            subtitle={card.subtitle}
            title={card.title}
          />
        ))}
      </div>

      <div className="controls-grid">
        <article className="controls-card">
          <p className="controls-label">Keyboard</p>
          <ul>
            <li>`W` / `ArrowUp`: pitch up</li>
            <li>`S` / `ArrowDown`: pitch down</li>
            <li>`A` / `ArrowLeft`: bank left</li>
            <li>`D` / `ArrowRight`: bank right</li>
            <li>`Q` / `E`: throttle down / up</li>
          </ul>
        </article>

        <article className="controls-card">
          <p className="controls-label">Touch + mode</p>
          <ul>
            <li>Bottom deck mirrors pitch, bank, and throttle</li>
            <li>`M`: toggle autopilot/manual</li>
            <li>`C`: cycle chase/cinematic/free camera</li>
            <li>`R`: reset position or restart a finished run</li>
            <li>`Space`: pause or resume an active run</li>
          </ul>
        </article>
      </div>
    </div>
  )
}

function statusChipClassName(variant?: StatusChipData['variant']): string {
  if (variant === 'accent') {
    return 'status-chip accent'
  }

  return `status-chip${variant ? ` is-${variant}` : ''}`
}

function TelemetryCard({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <article className="telemetry-card">
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  )
}

function MissionCard({
  label,
  subtitle,
  title,
}: {
  label: string
  subtitle: string
  title: string
}) {
  return (
    <article className="mission-card">
      <p>{label}</p>
      <strong>{title}</strong>
      <span>{subtitle}</span>
    </article>
  )
}
