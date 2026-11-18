param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [int]$TimeoutSeconds = 40
)

# Hängt sich an die Konsole des Zielprozesses und schickt CTRL+C,
# damit der AzerothCore-Server sauber speichert und beendet wird.
# Erst nach Timeout wird hart gekillt (taskkill /F).

Add-Type -Namespace Native -Name Win32 -MemberDefinition @"
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool AttachConsole(uint dwProcessId);

[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool FreeConsole();

[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool GenerateConsoleCtrlEvent(uint dwCtrlEvent, uint dwProcessGroupId);

[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool SetConsoleCtrlHandler(Int32 HandlerRoutine, bool Add);
"@

# Eigene Ctrl-Handler unterdruecken, damit sich dieses Skript nicht selbst beendet.
[Native.Win32]::SetConsoleCtrlHandler($null, $true) | Out-Null

if (-not [Native.Win32]::AttachConsole([uint32]$ProcessId)) {
  # Keine Konsole (z.B. als Service gestartet) -> direkt hart beenden.
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  exit 0
}

$CTRL_C = 0
[Native.Win32]::GenerateConsoleCtrlEvent($CTRL_C, 0) | Out-Null
Start-Sleep -Milliseconds 250

$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
  if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
    [Native.Win32]::FreeConsole() | Out-Null
    exit 0
  }
  Start-Sleep -Milliseconds 400
}

Write-Output "TIMEOUT"
[Native.Win32]::FreeConsole() | Out-Null
Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
exit 0