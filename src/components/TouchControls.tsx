import { type PointerEvent as ReactPointerEvent } from 'react'

type TouchInput = 'a' | 'd' | 'e' | 'q' | 's' | 'w'

interface TouchControlsProps {
  activeInputs: TouchInput[]
  onActiveChange: (control: TouchInput, active: boolean) => void
}

export function TouchControls({
  activeInputs,
  onActiveChange,
}: TouchControlsProps) {
  return (
    <div className="touch-deck" aria-label="Touch flight controls">
      <div className="touch-pad">
        <TouchButton
          active={activeInputs.includes('w')}
          label="Pitch +"
          onActiveChange={onActiveChange}
          value="w"
        />
        <div className="touch-row">
          <TouchButton
            active={activeInputs.includes('a')}
            label="Bank L"
            onActiveChange={onActiveChange}
            value="a"
          />
          <TouchButton
            active={activeInputs.includes('s')}
            label="Pitch -"
            onActiveChange={onActiveChange}
            value="s"
          />
          <TouchButton
            active={activeInputs.includes('d')}
            label="Bank R"
            onActiveChange={onActiveChange}
            value="d"
          />
        </div>
      </div>

      <div className="touch-throttle">
        <TouchButton
          active={activeInputs.includes('e')}
          label="Throttle +"
          onActiveChange={onActiveChange}
          value="e"
        />
        <TouchButton
          active={activeInputs.includes('q')}
          label="Throttle -"
          onActiveChange={onActiveChange}
          value="q"
        />
      </div>
    </div>
  )
}

function TouchButton({
  active,
  label,
  onActiveChange,
  value,
}: {
  active: boolean
  label: string
  onActiveChange: (control: TouchInput, active: boolean) => void
  value: TouchInput
}) {
  function activate(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    onActiveChange(value, true)
  }

  function deactivate() {
    onActiveChange(value, false)
  }

  return (
    <button
      type="button"
      className={`touch-button${active ? ' is-active' : ''}`}
      onPointerCancel={deactivate}
      onPointerDown={activate}
      onPointerLeave={deactivate}
      onPointerUp={deactivate}
    >
      {label}
    </button>
  )
}
