param(
    [int]$ApiPort = 8010,
    [int]$WebPort = 3010
)

$ErrorActionPreference = 'SilentlyContinue'

function Stop-ProcessIds {
    param(
        [int[]]$ProcessIds,
        [string]$Reason
    )

    foreach ($processId in ($ProcessIds | Sort-Object -Unique)) {
        if ($processId -and $processId -ne $PID) {
            try {
                Stop-Process -Id $processId -Force -ErrorAction Stop
                Write-Host "Stopped PID $processId ($Reason)"
            }
            catch {
                Write-Host "Could not stop PID $processId ($Reason): $($_.Exception.Message)"
            }
        }
    }
}

function Stop-MatchingProcesses {
    param(
        [string]$Pattern,
        [string]$Reason
    )

    $matches = Get-CimInstance Win32_Process |
        Where-Object { $_.CommandLine -and $_.CommandLine -match $Pattern }

    Stop-ProcessIds -ProcessIds ($matches | Select-Object -ExpandProperty ProcessId) -Reason $Reason
}

function Stop-PortListeners {
    param(
        [int]$Port,
        [string]$Reason
    )

    $listeners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if ($listeners) {
        Stop-ProcessIds -ProcessIds ($listeners | Select-Object -ExpandProperty OwningProcess) -Reason "$Reason on port $Port"
    }
}

# Stop any existing Woodshed API and web processes, regardless of port.
Stop-MatchingProcesses -Pattern 'uvicorn(\\.exe)?\s+woodshed\.api:app|python(\\.exe)?\s+-m\s+woodshed\.api' -Reason 'existing Woodshed API process'
Stop-MatchingProcesses -Pattern 'node(\\.exe)?.*Woodshed\\web\\server\.js|npm(\\.cmd)?\s+--prefix\s+web\s+start|npm(\\.cmd)?\s+run\s+web' -Reason 'existing Woodshed web process'

# Also clear intended ports if anything else is occupying them.
Stop-PortListeners -Port $ApiPort -Reason 'listener conflict'
Stop-PortListeners -Port $WebPort -Reason 'listener conflict'
