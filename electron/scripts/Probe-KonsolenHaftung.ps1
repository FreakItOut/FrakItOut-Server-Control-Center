# Prueft NUR, ob sich die Konsole eines laufenden Servers anhaengen laesst.
# Es wird bewusst KEIN Befehl gesendet - der Server laeuft, und das Spiel
# haengt daran.
#
# Aufruf: powershell -File .\electron\scripts\Probe-KonsolenHaftung.ps1 -ProcessId 1234

param([Parameter(Mandatory = $true)][int]$ProcessId)

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class Konsole {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool AttachConsole(uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool FreeConsole();

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetConsoleScreenBufferInfo(IntPtr hConsoleInfo, out CONSOLE_SCREEN_BUFFER_INFO lpConsoleScreenBufferInfo);

    [StructLayout(LayoutKind.Sequential)]
    public struct COORD { public short X; public short Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct SMALL_RECT {
        public short Left; public short Top; public short Right; public short Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct CONSOLE_SCREEN_BUFFER_INFO {
        public COORD dwSize;
        public COORD dwCursorPosition;
        public short wAttributes;
        public SMALL_RECT srWindow;
        public COORD dwMaximumWindowSize;
    }
}
"@

$STD_INPUT_HANDLE = -10

Write-Output "  Zielprozess: $ProcessId"

$p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
if (-not $p) {
    Write-Output "  FEHLER: Prozess $ProcessId laeuft nicht"
    exit 1
}
Write-Output "  Prozess: $($p.ProcessName)"

# Reihenfolge ist wichtig, und die erste Fassung hatte sie falsch.
#
# Zuerst wurde gefragt "hat MEIN Prozess eine Konsole?". Das beantwortet
# die Frage nicht und beantwortet sie hier sogar falsch: dieses Skript
# laeuft aus einer unsichtbaren Konsole, also meldete es "keine Konsole"
# und haette damit einen Server verleumdet, den es nicht betraf.
#
# Richtig ist die umgekehrte Reihenfolge: erst anhaengen. Kann man sich an
# die Konsole eines Prozesses anhaengen, dann hat er eine - und man sieht
# sie auch.

# Bevor angehaengt wird, muss eine vorhandene eigene Konsole weg.
#
# AttachConsole bricht mit Fehler 5 (Zugriff verweigert) ab, wenn der
# aufrufende Prozess schon eine Konsole hat - das sieht dann aus, als
# haette der Zielprozess keine, ist aber genau umgekehrt. Die Gegenprobe
# an einem Prozess mit Konsole hat diesen Fall sichtbar gemacht.
[Konsole]::FreeConsole() | Out-Null

if (-not [Konsole]::AttachConsole([uint32]$ProcessId)) {
    $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Output "  KEINE KONSOLE. AttachConsole schlug fehl (Fehler $err)."
    Write-Output "  5 = Zugriff verweigert, 6 = ungueltiges Handle."
    Write-Output "  Ein Server ohne Konsole nimmt Befehle nur per SOAP entgegen."
    exit 2
}

Write-Output "  OK: Die Konsole des Servers haengt sich an."

$h = [Konsole]::GetStdHandle($STD_INPUT_HANDLE)
$info = New-Object Konsole+CONSOLE_SCREEN_BUFFER_INFO
if ([Konsole]::GetConsoleScreenBufferInfo($h, [ref]$info)) {
    $breite = $info.srWindow.Right - $info.srWindow.Left + 1
    $hoehe = $info.srWindow.Bottom - $info.srWindow.Top + 1
    Write-Output "  Fenstergroesse: ${breite} x ${hoehe}"
    Write-Output "  Cursor: Zeile $($info.dwCursorPosition.Y), Spalte $($info.dwCursorPosition.X)"
    if ($hoehe -lt 200) {
        Write-Output "  Kleine Hoehe - das sieht nach einem echten Fenster aus, nicht nach einem versteckten Handle."
    }
}

Write-Output ""
Write-Output "  Ueber diesen Eingabekanal liesse sich ein Befehl schreiben."
Write-Output "  Bewusst nicht getan: der Server laeuft, und das Spiel haengt daran."

[Konsole]::FreeConsole() | Out-Null
exit 0